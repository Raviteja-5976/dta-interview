/**
 * POST /api/sessions/[sessionId]/reflect — the slow lane of a pipelined turn.
 *
 * Fired by the client immediately after `/turn` resolves, and runs while the
 * interviewer is speaking the next question. It reads the answer that just
 * landed, decides whether it is worth returning to, and if so writes a worded
 * follow-up for a later turn to ask.
 *
 * ── Why a separate request and not background work inside /turn ─────────────
 * There is no job queue in this system, and work started in a route handler
 * after the response has been sent is not guaranteed to run to completion on
 * serverless compute — the container can be frozen or reclaimed the moment the
 * response is flushed. A request the client is holding open has its own
 * lifetime, so this is the arrangement that actually finishes.
 *
 * ── Why it cannot clobber the turn ──────────────────────────────────────────
 * It writes ONE column, `pending_followup`, and never touches `live_state`.
 * `/turn` owns `live_state` and never writes `pending_followup` except to clear
 * the row it just consumed. Two writers, two columns, no read-modify-write on
 * shared JSONB — the concurrency is correct by construction rather than by
 * timing (migration 016).
 *
 * Failure here is invisible and harmless: no follow-up is queued and the
 * interview proceeds on its planned questions.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { reflectOnAnswer, type LiveState } from '@/lib/pipelines/turn';
import type { Blueprint } from '@/lib/agents/schemas';
import { handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 30;

interface ReflectBody {
  questionId: string;
  transcript: string;
  wordCount: number;
  durationSec: number;
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/reflect'>) {
  try {
    const { sessionId } = await ctx.params;
    const user = await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, project_id, status, config, blueprint, live_state')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    // Reflection on a finished interview has nothing to feed. Not an error —
    // the client fires this without waiting to see how the turn resolved.
    if (session.status !== 'live' && session.status !== 'ready') {
      return ok({ queued: false, reason: 'session is not live' });
    }

    const blueprint = session.blueprint as Blueprint | null;
    const state = session.live_state as LiveState | null;
    if (!blueprint || !state) return ok({ queued: false, reason: 'not prepared' });

    const body = (await request.json()) as ReflectBody;
    if (!body.transcript?.trim() || !body.questionId) {
      return ok({ queued: false, reason: 'nothing to reflect on' });
    }

    const config = session.config as { persona?: string; difficulty?: 'easy' | 'medium' | 'hard' };

    const followup = await reflectOnAnswer({
      sessionId,
      userId: user.id,
      projectId: session.project_id,
      blueprint,
      state,
      persona: config.persona ?? 'warm_professional',
      difficulty: config.difficulty ?? 'medium',
      answer: {
        transcript: body.transcript,
        wordCount: body.wordCount ?? body.transcript.split(/\s+/).filter(Boolean).length,
        durationSec: body.durationSec ?? 0,
      },
      questionId: body.questionId,
    });

    if (!followup) return ok({ queued: false });

    // Service role: `pending_followup` is the interviewer's own working state and
    // the browser must not be able to write its own next question.
    await createAdminClient()
      .from('sessions')
      .update({ pending_followup: followup })
      .eq('id', sessionId);

    return ok({ queued: true, question: followup.question });
  } catch (err) {
    return handleRouteError(err);
  }
}
