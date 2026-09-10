/**
 * POST /api/sessions/[sessionId]/prep — advance P5' → (P6 ∥ P7) → opening clip.
 *
 * Called by the interview screen in a loop while it shows "Building your
 * interview…". Each request is one durable pass (lib/pipelines/pipeline-runs.ts)
 * of a few seconds; it answers `pending: true` until the pass that finishes the
 * session, so no request comes near Amplify's 30-second limit even though P6
 * and P7 together can run for minutes.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  publishSessionProgress,
  runSessionPrep,
  type SessionPrepResult,
} from '@/lib/pipelines/session-prep';
import { advanceRun, loadRun, startRun } from '@/lib/pipelines/pipeline-runs';
import { handleRouteError, notFound, ok } from '@/lib/api/respond';

/** A pass takes seconds. This is only a ceiling for hosts that honour it. */
export const maxDuration = 60;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/prep'>) {
  try {
    const { sessionId } = await ctx.params;
    const user = await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, status, error')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();
    if (session.status === 'ready' || session.status === 'live') {
      return ok({ status: session.status, alreadyPrepared: true });
    }
    if (session.status === 'failed') {
      const message = (session.error as { message?: string } | null)?.message;
      return ok({ status: 'failed', error: message ?? 'We could not build your interview.' });
    }

    const admin = createAdminClient();

    let run = await loadRun(admin, 'session_prep', sessionId);
    if (!run || run.status !== 'running') {
      run = await startRun(admin, {
        kind: 'session_prep',
        subjectId: sessionId,
        userId: user.id,
        previous: run,
      });
    }

    const snapshot = await advanceRun(
      admin,
      run,
      async () => {
        const result = await runSessionPrep(admin, sessionId);
        return { ok: result.status === 'ready', error: result.error, result };
      },
      // The interview screen follows `sessions.progress` over realtime. Written
      // here, once per stage change, rather than from inside the pipeline —
      // which re-runs from the top on every pass.
      { onProgress: (p) => publishSessionProgress(admin, sessionId, p.stage, p.detail) },
    );

    if (snapshot.status === 'running') {
      return ok({ status: 'preparing', pending: true, progress: snapshot.progress });
    }

    const result = snapshot.result as SessionPrepResult | null;

    // A pass that threw, rather than returning, never reached failSession.
    if (snapshot.status === 'failed' && snapshot.settledNow && !result) {
      await admin
        .from('sessions')
        .update({
          status: 'failed',
          error: {
            stage: 'session_prep',
            message: snapshot.error ?? 'Session preparation failed.',
            at: new Date().toISOString(),
          },
        })
        .eq('id', sessionId)
        .eq('status', 'preparing');
    }

    return ok({
      status: snapshot.status === 'done' ? 'ready' : 'failed',
      voiceAssetsCached: result?.voiceAssetsCached ?? 0,
      error: result?.error ?? snapshot.error ?? undefined,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
