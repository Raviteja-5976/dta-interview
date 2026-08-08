/**
 * POST /api/sessions/[sessionId]/turn — one live turn.
 *
 * L3 → §4 → L1 → §4 → L4, then a signed URL for the audio. Target ≤1.25s worst
 * case, ~0.75s on a cached turn (agentdesign.md §10).
 *
 * ── On live_state and Redis ──────────────────────────────────────────────────
 * db-design.md §1.6 is explicit that per-turn state belongs in Redis, with a
 * checkpoint written to `sessions.live_state` every ~5 turns. There is no Redis
 * here yet, so every turn writes the checkpoint. That is correct but chattier
 * than the design intends; moving L2/L3 state into Redis is the first thing to
 * do when turn latency starts to matter.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runTurn, type LiveState } from '@/lib/pipelines/turn';
import { settleSession } from '@/lib/credits';
import { prosodyToInstructions, synthesizeUtterance } from '@/lib/ai/voice';
import type { Blueprint } from '@/lib/agents/schemas';
import type { VoiceAssetIndex } from '@/lib/pipelines/session-prep';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 60;

interface TurnBody {
  answer?: {
    transcript: string;
    durationSec: number;
    wordCount: number;
    startMs: number;
    endMs: number;
    asrConfidence?: number;
    partiallyHeard?: boolean;
    words?: Array<{ w: string; s: number; e: number; conf?: number }>;
  };
  elapsedSec: number;
  /**
   * The candidate pressed "End interview". Kept separate from `elapsedSec`
   * rather than faking a huge elapsed value — that would land in `duration_sec`
   * and, under metered billing, in the amount charged.
   */
  endNow?: boolean;
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/turn'>) {
  try {
    const { sessionId } = await ctx.params;
    const user = await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, project_id, status, config, blueprint, live_state, voice_assets, started_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();
    if (session.status !== 'live' && session.status !== 'ready') {
      return failure(409, `This interview is ${session.status} and cannot take another turn.`);
    }

    const blueprint = session.blueprint as Blueprint | null;
    const state = session.live_state as LiveState | null;
    if (!blueprint || !state) return failure(409, 'This interview has not finished preparing.');

    const body = (await request.json()) as TurnBody;
    const config = session.config as { duration_min: number; persona: string; language: string };

    const admin = createAdminClient();

    // Word timings go to Storage, not Postgres — ~2,000 words per session, read
    // once by E2 and then effectively never (db-design.md §1.6).
    if (body.answer?.words?.length) {
      const lastSeq = state.questions.length;
      await admin.storage
        .from('transcripts')
        .upload(
          `${session.user_id}/${sessionId}/q_${lastSeq}.json`,
          new Blob([JSON.stringify(body.answer.words)], { type: 'application/json' }),
          { upsert: true },
        )
        .catch(() => null);
    }

    const plannedMinutes = config.duration_min ?? 15;
    const maxDurationSec = plannedMinutes * 60;

    // Real elapsed time, never the sentinel. `endNow` short-circuits the loop
    // without inflating the clock the candidate is billed against.
    const elapsedSec = Math.max(0, Math.min(body.elapsedSec, maxDurationSec));

    const result = await runTurn({
      sessionId,
      userId: user.id,
      projectId: session.project_id,
      blueprint,
      state,
      persona: config.persona ?? 'warm_professional',
      answer: body.answer,
      elapsedSec: body.endNow ? maxDurationSec : elapsedSec,
      maxDurationSec,
    });

    // The interview is over — settle the credits, then hand off to evaluation.
    if (result.finished) {
      const durationSec = Math.round(elapsedSec);

      await admin
        .from('sessions')
        .update({
          status: 'processing',
          live_state: result.state,
          duration_sec: durationSec,
          ended_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      const settlement = await settleSessionBilling({
        admin,
        sessionId,
        durationSec,
        plannedMinutes,
        questions: result.state.questions,
        blueprint,
      });

      return ok({
        finished: true,
        redirectTo: `/sessions/${sessionId}/processing`,
        billing: settlement,
      });
    }

    const audio = await resolveAudio({
      admin,
      userId: session.user_id,
      projectId: session.project_id,
      sessionId,
      assets: session.voice_assets as VoiceAssetIndex | null,
      utterance: result.utterance!,
    });

    await admin
      .from('sessions')
      .update({
        status: 'live',
        live_state: result.state,
        started_at: session.started_at ?? new Date().toISOString(),
      })
      .eq('id', sessionId);

    return ok({
      finished: false,
      questionId: result.utterance!.questionId,
      question: result.utterance!.plan.utterance,
      spoken: [
        result.utterance!.plan.acknowledgement,
        result.utterance!.plan.transition,
        result.utterance!.plan.utterance,
      ]
        .filter(Boolean)
        .join(' '),
      prosody: result.utterance!.plan.prosody,
      allowBargeInAfterMs: result.utterance!.plan.allow_barge_in_after_ms,
      audio,
      section: {
        id: result.state.runtime.current_section_id,
        title: blueprint.sections.find((s) => s.section_id === result.state.runtime.current_section_id)?.title,
      },
      progress: {
        sectionsTotal: blueprint.sections.length,
        sectionsCompleted: result.state.runtime.sections_completed.length,
        turn: result.state.runtime.turn,
      },
      // Never surfaced to the candidate — invariant R5 / sitemap §9: no scores,
      // correctness, or feedback on this screen. This block is for the ops view.
      diagnostics: result.diagnostics,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Settles the hold taken at session start.
 *
 * Modules are charged only if they were actually delivered — a candidate who
 * ended the interview before the coding round never got a coding round, and
 * billing 20 credits for it would be indefensible.
 */
async function settleSessionBilling(args: {
  admin: ReturnType<typeof createAdminClient>;
  sessionId: string;
  durationSec: number;
  plannedMinutes: number;
  questions: LiveState['questions'];
  blueprint: Blueprint;
}): Promise<{ charged: number; billedMinutes: number } | null> {
  // `grading_mode` is assigned at plan time and never changes (invariant 9), so
  // it is the reliable signal that a coding question was actually asked.
  const codingDelivered = args.questions.some((q) => q.grading_mode === 'coding');

  // System design has no grading mode of its own, so it resolves through the
  // section TYPE in the blueprint. Matching on section_id would not work —
  // those are opaque ids like "sec_4", not labels.
  const designSectionIds = new Set(
    args.blueprint.sections.filter((s) => s.type === 'system_design').map((s) => s.section_id),
  );
  const designDelivered = args.questions.some((q) => designSectionIds.has(q.section_id));

  const settlement = settleSession({
    actualSeconds: args.durationSec,
    plannedMinutes: args.plannedMinutes,
    codingDelivered,
    designDelivered,
  });

  const { error } = await args.admin.rpc('settle_session_credits', {
    p_session_id: args.sessionId,
    p_final: settlement.total,
    p_meta: {
      billed_minutes: settlement.billedMinutes,
      duration_sec: args.durationSec,
      coding_delivered: codingDelivered,
      design_delivered: designDelivered,
    },
  });

  if (error) {
    // The hold stands until this succeeds. Log loudly — this is money.
    console.error('[billing] settlement failed', args.sessionId, error.message);
    return null;
  }

  return { charged: settlement.total, billedMinutes: settlement.billedMinutes };
}

/**
 * P8 cache resolution. Invariant 17: a cached clip is played ONLY when its text
 * exactly matches the utterance plan. On any mismatch we synthesize live rather
 * than adjusting the wording to force a hit.
 */
async function resolveAudio(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  projectId: string;
  sessionId: string;
  assets: VoiceAssetIndex | null;
  utterance: { plan: { utterance: string; acknowledgement: string; transition: string; prosody: { emotion: string; rate: number; emphasis: string[] } }; cacheText: string; questionId: string };
}): Promise<{ url: string | null; source: 'cache' | 'live_tts' | 'none' }> {
  const spoken = [
    args.utterance.plan.acknowledgement,
    args.utterance.plan.transition,
    args.utterance.plan.utterance,
  ]
    .filter(Boolean)
    .join(' ');

  // A cache hit needs the FULL spoken line to match, not just the question —
  // otherwise the acknowledgement and transition would be silently dropped.
  const hit = args.assets?.assets.find((a) => a.text === spoken);

  if (hit) {
    const { data } = await args.admin.storage.from('voice').createSignedUrl(hit.path, 900);
    if (data?.signedUrl) return { url: data.signedUrl, source: 'cache' };
  }

  try {
    const { audio, mediaType } = await synthesizeUtterance(spoken, {
      voice: args.assets?.voice,
      speed: args.utterance.plan.prosody.rate,
      instructions: prosodyToInstructions(args.utterance.plan.prosody),
      context: { userId: args.userId, projectId: args.projectId, sessionId: args.sessionId },
    });

    const path = `${args.userId}/${args.sessionId}/live_${args.utterance.questionId}.mp3`;
    await args.admin.storage.from('voice').upload(path, audio, { contentType: mediaType, upsert: true });

    const { data } = await args.admin.storage.from('voice').createSignedUrl(path, 900);
    return { url: data?.signedUrl ?? null, source: 'live_tts' };
  } catch {
    // Text still renders on screen — invariant 12, degrade texture, not the run.
    return { url: null, source: 'none' };
  }
}
