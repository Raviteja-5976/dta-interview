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
import { CREDITS_PER_MINUTE, billableMinutes, voiceCredits } from '@/lib/credits';
import type { Blueprint, CodingChallenge, SkillChallenge } from '@/lib/agents/schemas';
import type { ChallengeSet } from '@/lib/agents/p7-challenge';
import type { VoiceAssetIndex } from '@/lib/pipelines/session-prep';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 60;

/**
 * Upper bound on reported editor time — see where it is applied.
 *
 * Covers both editor rounds: the DSA problems and the skill challenge share one
 * accumulator on the client, because from billing's point of view they are the
 * same thing — minutes where nobody is talking and the flat module fee has
 * already been paid.
 */
const MAX_CODING_SEC = 45 * 60;

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
   * Seconds spent inside the code editor, accumulated by the client across
   * BOTH editor rounds — the DSA problems and the skill challenge.
   *
   * Excluded from per-minute billing: each round is already paid for by its
   * flat module fee, and charging voice credits for time nobody is talking
   * would bill the same minutes twice.
   */
  codingSec?: number;
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
      .select(
        'id, user_id, project_id, status, config, blueprint, live_state, voice_assets, coding_challenge, skill_challenge, started_at',
      )
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
    const config = session.config as {
      duration_min: number;
      persona: string;
      language: string;
      difficulty?: 'easy' | 'medium' | 'hard';
    };

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

    /*
     * Capped because it is a client-supplied number that now extends the
     * interview's ceiling. Billing already clamps it against the real duration,
     * so an inflated value could never win free credits — but without a bound
     * independent of elapsed time, a client reporting "all of it was coding"
     * would push the ceiling out as fast as the clock advanced and the interview
     * would never reach its hard stop.
     *
     * Three challenges at fifteen minutes each is already far past any real
     * coding round.
     */
    const codingSec = Math.min(Math.max(0, body.codingSec ?? 0), MAX_CODING_SEC);

    /*
     * The duration budget is in CONVERSATION minutes, so time in the editor
     * extends the wall clock rather than consuming it.
     *
     * This matters now that the coding round runs at the end: a twelve-minute
     * coding round against a fifteen-minute ceiling would trip the hard stop the
     * moment the candidate submitted, ending the interview before the closing
     * section and cutting short a round they paid a flat module fee for.
     *
     * Billing is unaffected — `chargeVoiceTime` subtracts the same coding
     * seconds from the metered duration, so nobody is charged for them.
     */
    const maxDurationSec = plannedMinutes * 60 + codingSec;

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
      // Sets how many questions each section gets (R12).
      difficulty: config.difficulty ?? 'medium',
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

      const billing = await chargeVoiceTime({
        admin,
        sessionId,
        durationSec,
        codingSec: Math.min(codingSec, durationSec),
        ceilingMinutes: plannedMinutes,
      });

      return ok({
        finished: true,
        redirectTo: `/sessions/${sessionId}/processing`,
        billing,
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
      /*
       * What this question is trying to establish.
       *
       * Resolved inside the turn from objects already in memory — no extra
       * model call, no extra round trip, nothing added to the silence the
       * candidate waits through. Shown on screen beside the question so it is
       * clear what is being asked and why, and stored on the question record so
       * the report's goal outcomes quote the same statement.
       */
      goal: result.utterance!.goal,
      /*
       * Coding mode. The section TYPE decides it, not the question text — the
       * blueprint assigns type at plan time, so this cannot drift.
       *
       * The client switches to the editor layout, pauses the voice loop, and
       * stops the billing clock for as long as the candidate is writing code.
       */
      mode: currentSectionType(blueprint, result.state.runtime.current_section_id),
      challenge: codingPayload(
        blueprint,
        result.state.runtime.current_section_id,
        session.coding_challenge as ChallengeSet<CodingChallenge> | null,
        result.state,
      ),
      /*
       * The skill round's task, when the interview has reached that section.
       *
       * A separate field rather than a shape inside `challenge` because the two
       * rounds are two different screens: one has a test runner and a language
       * picker, the other has neither. Collapsing them into one payload would
       * make every consumer branch on a discriminator to find out which half of
       * the object is populated.
       */
      skillChallenge: skillPayload(
        blueprint,
        result.state.runtime.current_section_id,
        session.skill_challenge as ChallengeSet<SkillChallenge> | null,
        result.state,
      ),
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


/** The blueprint's type for the section currently being asked. */
function currentSectionType(blueprint: Blueprint, sectionId: string): string {
  return blueprint.sections.find((s) => s.section_id === sectionId)?.type ?? 'resume_skills';
}

/**
 * The challenge the editor should open, when the interview has reached a coding
 * section.
 *
 * Hidden tests are deliberately absent from this payload. They are only ever
 * evaluated server-side by the code route — putting them in a response the
 * browser can read would defeat the point of hiding them.
 */
function codingPayload(
  blueprint: Blueprint,
  sectionId: string,
  set: ChallengeSet<CodingChallenge> | null,
  state: LiveState,
): unknown {
  if (currentSectionType(blueprint, sectionId) !== 'coding') return null;
  if (!set?.challenges?.length) return null;

  const submitted = Array.isArray((state as unknown as { coding_submissions?: unknown[] }).coding_submissions)
    ? (state as unknown as { coding_submissions: unknown[] }).coding_submissions.length
    : 0;

  /*
   * Null once every problem has been submitted, even though the section is
   * still `coding`.
   *
   * This used to clamp the index to the last challenge, which meant the editor
   * reopened on a problem the candidate had already solved every time the
   * coding section took another turn — and the client parks its voice loop
   * whenever a challenge comes back, so the interviewer could never get to
   * "talk me through what you wrote". Returning null hands the floor back to
   * the conversation, which is the point of the turns that follow a submission.
   */
  if (submitted >= set.challenges.length) return null;

  const index = submitted;
  const challenge = set.challenges[index];

  return {
    index,
    total: set.challenges.length,
    title: challenge.title,
    topic: challenge.topic,
    level: challenge.level,
    problem_statement: challenge.problem_statement,
    constraints: challenge.constraints,
    input_format: challenge.input_format,
    output_format: challenge.output_format,
    examples: challenge.examples,
    starter_code: challenge.starter_code,
    visible_tests: challenge.visible_tests,
    target_complexity: challenge.target_complexity,
    hidden_test_count: challenge.hidden_tests.length,
  };
}

/**
 * The skill task the editor should open, when the interview has reached the
 * skill-challenge section.
 *
 * Three fields of the stored challenge are deliberately absent from this
 * payload, and one of them matters a great deal: `bug_summary` names the fault
 * planted in a debug task. Sending it to the browser would put the answer one
 * devtools panel away from the candidate being tested on finding it.
 * `reference_solution` and `requirements` are withheld for the same reason —
 * the requirements ARE the mark scheme, and a candidate reading them is
 * completing a checklist rather than doing the task.
 */
function skillPayload(
  blueprint: Blueprint,
  sectionId: string,
  set: ChallengeSet<SkillChallenge> | null,
  state: LiveState,
): unknown {
  if (currentSectionType(blueprint, sectionId) !== 'skill_challenge') return null;
  if (!set?.challenges?.length) return null;

  const submitted = Array.isArray((state as unknown as { skill_submissions?: unknown[] }).skill_submissions)
    ? (state as unknown as { skill_submissions: unknown[] }).skill_submissions.length
    : 0;

  // Every task submitted — hand the floor back to the conversation so the
  // interviewer can ask its discussion probes. Same reasoning as codingPayload.
  if (submitted >= set.challenges.length) return null;

  const index = submitted;
  const challenge = set.challenges[index];

  return {
    index,
    total: set.challenges.length,
    skill: challenge.skill,
    format: challenge.format,
    title: challenge.title,
    prompt: challenge.prompt,
    context: challenge.context,
    editor_language: challenge.editor_language,
    starter_code: challenge.starter_code,
    estimated_minutes: challenge.estimated_minutes,
    /*
     * The COUNT of requirements, not the requirements.
     *
     * A candidate should know how many things are being looked for — that is
     * scoping information a real interviewer gives out loud — without being
     * handed the mark scheme itself.
     */
    requirement_count: challenge.requirements.length,
  };
}

/**
 * Charges voice time, once the interview is over and the duration is known.
 *
 * Nothing was held for this. Someone who ended after four minutes is billed for
 * four minutes — that is the whole point of post-paid time — but it also means
 * this is the only chance to collect, so a failure here is lost revenue and gets
 * logged accordingly. `unbilled_sessions` (migration 015) is the backstop.
 *
 * Modules are not touched: they were charged at session creation because their
 * generation cost was incurred during preparation.
 */
async function chargeVoiceTime(args: {
  admin: ReturnType<typeof createAdminClient>;
  sessionId: string;
  durationSec: number;
  codingSec: number;
  ceilingMinutes: number;
}): Promise<{ minutes: number; credits: number } | null> {
  // Only conversation time is metered. The coding round is paid for by its flat
  // module fee, so billing its minutes again would charge for them twice.
  const spokenSec = Math.max(0, args.durationSec - args.codingSec);
  const minutes = billableMinutes(spokenSec, args.ceilingMinutes);

  const { error } = await args.admin.rpc('charge_interview_time', {
    p_session_id: args.sessionId,
    p_minutes: minutes,
    p_meta: {
      duration_sec: args.durationSec,
      coding_sec: Math.round(args.codingSec),
      billed_sec: Math.round(spokenSec),
      ceiling_minutes: args.ceilingMinutes,
      rate_per_minute: CREDITS_PER_MINUTE,
    },
  });

  if (error) {
    console.error('[billing] voice charge failed', args.sessionId, error.message);
    return null;
  }

  return { minutes, credits: voiceCredits(minutes) };
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
}): Promise<{ segments: AudioSegment[]; source: 'cache' | 'live_tts' | 'mixed' | 'none' }> {
  /*
   * ── Why nothing is synthesized here any more ─────────────────────────────
   *
   * This used to call the TTS model, wait for the whole MP3, upload it to
   * Storage, and mint a signed URL — all inside the turn, before the response
   * was sent, for every segment that missed the cache. The candidate's "thinking"
   * gap was L1 + L4 + all of that, serially, and none of it could start until
   * the words existed.
   *
   * A cache miss now returns a URL the browser streams from instead. The turn
   * returns as soon as L4 has the words, and audio starts playing as the first
   * bytes arrive rather than after the last one is written to a bucket. The
   * round trip to Storage bought nothing: these clips are unique to one turn and
   * are never read again.
   */
  /*
   * Resolved PER SEGMENT, not as one concatenated line.
   *
   * P8 renders each acknowledgement, transition and bank question as its own
   * clip. Looking up the joined string could therefore only ever hit when both
   * the acknowledgement and the transition happened to be empty — so in
   * practice the cache never hit, every turn paid live TTS, and the ~40 clips
   * P8 generated during preparation were thrown away. That is most of what made
   * prep slow AND turns slow, from one line of matching logic.
   *
   * Matching each part separately is what D7 actually describes, and it keeps
   * invariant 17 intact: a clip is played only when its text matches exactly.
   */
  const parts = [
    { kind: 'acknowledgement' as const, text: args.utterance.plan.acknowledgement },
    { kind: 'transition' as const, text: args.utterance.plan.transition },
    { kind: 'utterance' as const, text: args.utterance.plan.utterance },
  ].filter((p) => p.text.trim().length > 0);

  const segments: AudioSegment[] = [];

  const prosody = args.utterance.plan.prosody;

  for (const part of parts) {
    const hit = args.assets?.assets.find((a) => a.text === part.text);

    if (hit) {
      const { data } = await args.admin.storage.from('voice').createSignedUrl(hit.path, 900);
      if (data?.signedUrl) {
        segments.push({ url: data.signedUrl, kind: part.kind, source: 'cache' });
        continue;
      }
    }

    // Same-origin, so the browser sends its session cookie and the Web Audio
    // graph is never tainted — which is the other thing that used to silence
    // playback when a cross-origin clip lost its CORS headers.
    const query = new URLSearchParams({
      text: part.text,
      emotion: prosody.emotion,
      rate: String(prosody.rate),
    });
    if (prosody.emphasis.length) query.set('emphasis', prosody.emphasis.join('|'));
    if (args.assets?.voice) query.set('voice', args.assets.voice);

    segments.push({
      url: `/api/sessions/${args.sessionId}/speak?${query.toString()}`,
      kind: part.kind,
      source: 'stream',
    });
  }

  if (segments.length === 0) return { segments: [], source: 'none' };

  const cached = segments.filter((s) => s.source === 'cache').length;
  const source = cached === segments.length ? 'cache' : cached === 0 ? 'live_tts' : 'mixed';

  return { segments, source };
}

interface AudioSegment {
  url: string;
  kind: 'acknowledgement' | 'transition' | 'utterance';
  /** `stream` is synthesized on demand by the speak route as the browser plays it. */
  source: 'cache' | 'stream';
}
