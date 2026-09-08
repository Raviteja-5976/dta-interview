/**
 * Phase 1 (session half) · P5' → (P6 ∥ P7) → P8.
 *
 * Runs per session and takes seconds rather than the ~60s of project prep,
 * because P1–P4 already ran once and are reused. That is the entire payoff of
 * the project/session split.
 *
 * P5 re-runs here rather than being reused from the project. Time allocation and
 * the difficulty ramp depend on the difficulty and modules chosen on the setup
 * screen, and on the ceiling the candidate's balance affords — all session
 * facts, none of them known at project creation. A strategy built for the
 * medium band is the wrong envelope for a 30-minute hard interview with a
 * coding round. It is a small `balanced` call, and getting the section budgets
 * right is worth more than saving it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { runStrategy } from '../agents/p5-strategy';
import { runBlueprint } from '../agents/p6-blueprint';
import { runCodingChallengeSet, runSkillChallengeSet } from '../agents/p7-challenge';
import { codingQuestionCount, skillQuestionCount } from '../credits';
import type {
  Blueprint,
  CompanyProfile,
  GapReport,
  JdProfile,
  ResumeProfile,
} from '../agents/schemas';
import { synthesizeUtterance, voiceForPersona } from '../ai/voice';
import { ACKNOWLEDGEMENT_POOL } from '../engine/rules';
import { seedCoverage } from '../engine/l3-evidence';
import { emptyMemory } from '../engine/l2-memory-store';
import { initialRuntime } from '../engine/types';
import { SESSION_PREP_STAGES, type SessionPrepStage } from './prep-stages';

export interface SessionConfig {
  difficulty: 'easy' | 'medium' | 'hard';
  /** Hard stop, and the cap settlement bills against. */
  duration_min: number;
  /** The band the interview is planned to fill. */
  target_min_minutes: number;
  target_max_minutes: number;
  language: string;
  persona: string;
  modules: { coding: boolean; skill_challenge: boolean; behavioral: boolean };
  focus_skills: string[];
}

export interface SessionPrepResult {
  status: 'ready' | 'failed';
  error?: string;
  voiceAssetsCached: number;
}


/**
 * Publishes progress to `sessions.progress`, which the interview screen watches
 * over realtime.
 *
 * Prep is tens of seconds of genuine work. Without this the screen has nothing
 * to show and a slow-but-healthy prep is indistinguishable from a hang — which
 * is exactly how a working system gets reported as broken.
 *
 * Never allowed to fail the pipeline: a missed progress write costs a UI update,
 * not a session.
 */
async function publishProgress(
  supabase: SupabaseClient,
  sessionId: string,
  stage: SessionPrepStage,
  detail?: string,
  clock?: { startedAt: number; lastAt: number },
): Promise<void> {
  const index = SESSION_PREP_STAGES.findIndex((s) => s.key === stage);

  // Per-stage timings. Prep is a single long request, so without these the only
  // observable fact is the total — and "it took four minutes" does not tell you
  // whether P6 is slow or P8 is synthesising forty clips for nothing.
  let timing = '';
  if (clock) {
    const now = Date.now();
    timing = ` [+${((now - clock.lastAt) / 1000).toFixed(1)}s, ${((now - clock.startedAt) / 1000).toFixed(1)}s total]`;
    clock.lastAt = now;
  }

  console.info(`[session-prep] ${sessionId} → ${stage}${detail ? ` (${detail})` : ''}${timing}`);

  await supabase
    .from('sessions')
    .update({
      progress: {
        stage,
        index,
        total: SESSION_PREP_STAGES.length,
        detail: detail ?? null,
        at: new Date().toISOString(),
      },
    })
    .eq('id', sessionId)
    .then(undefined, () => null);
}

export async function runSessionPrep(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<SessionPrepResult> {
  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, project_id, config')
    .eq('id', sessionId)
    .single();

  if (!session) return { status: 'failed', error: 'Session not found.', voiceAssetsCached: 0 };

  const { data: project } = await supabase
    .from('projects')
    .select('id, company_name, role_title, seniority, gap_report, jd_profile, company_profile')
    .eq('id', session.project_id)
    .single();

  if (!project?.gap_report || !project.jd_profile) {
    return await failSession(supabase, sessionId, 'This project has not finished preparing yet.');
  }

  const { data: resume } = await supabase
    .from('resumes')
    .select('parsed')
    .eq('project_id', session.project_id)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const resumeProfile = (resume?.parsed as { profile?: ResumeProfile } | null)?.profile;
  if (!resumeProfile) {
    return await failSession(supabase, sessionId, 'No parsed resume is available for this project.');
  }

  const config = session.config as SessionConfig;
  const context = { userId: session.user_id, projectId: session.project_id, sessionId };
  const clock = { startedAt: Date.now(), lastAt: Date.now() };

  try {
    await supabase.from('sessions').update({ status: 'preparing' }).eq('id', sessionId);
    await publishProgress(supabase, sessionId, 'strategy', undefined, clock);

    // ── P5' ──────────────────────────────────────────────────────────────────
    const strategy = await runStrategy(
      {
        gap: project.gap_report as GapReport,
        jd: project.jd_profile as JdProfile,
        config: {
          minMinutes: config.target_min_minutes ?? config.duration_min,
          maxMinutes: config.target_max_minutes ?? config.duration_min,
          difficulty: config.difficulty,
          coding: config.modules.coding,
          skillChallenge: config.modules.skill_challenge,
          focusSkills: config.focus_skills,
        },
      },
      context,
    );

    // ── P6 and P7, concurrently ──────────────────────────────────────────────
    //
    // P7 reads the strategy, the JD and the config. It has never read the
    // blueprint, so waiting for one before starting the other was pure serial
    // latency — on a session with both modules enabled that was the coding and
    // skill challenges, up to six deep-tier calls, queued behind the single
    // slowest thing in preparation for no reason at all.
    const jd = project.jd_profile as JdProfile;

    const challengeInput = {
      roleTitle: project.role_title,
      seniority: project.seniority ?? 'mid',
      prioritySkills: strategy.priority_skills,
      /*
       * What the JOB requires, most important first — which is not the same
       * list as `priority_skills`.
       *
       * `priority_skills` is what this interview decided to investigate, and
       * that is weighted towards gaps: the things the resume does not evidence.
       * The skill challenge is the "can you do the work" round, so it is
       * anchored to the role's actual requirements. A React role gets a React
       * task even when React was not the thing in doubt.
       *
       * `derived_from` rides along — it is the phrase in the posting the skill
       * was extracted from, and it is the difference between a task about
       * Kotlin and a task about what this job does with Kotlin.
       */
      requirements: [...jd.required_skills]
        .sort((a, b) => b.importance - a.importance)
        .map((s) => ({ skill: s.skill, derivedFrom: s.derived_from })),
      responsibilities: jd.responsibilities,
      domainKnowledge: jd.domain_knowledge,
      difficulty: config.difficulty,
      strategy,
    };

    // How many challenges each module carries. The fee is flat, the count is
    // not: difficulty sets the ambition and duration sets what physically fits,
    // capped at three either way.
    const codingCount = config.modules.coding
      ? codingQuestionCount(config.difficulty, config.duration_min)
      : 0;
    const skillCount = config.modules.skill_challenge
      ? skillQuestionCount(config.difficulty, config.duration_min)
      : 0;


    /*
     * P7 is launched first and awaited last.
     *
     * The dependency graph is P5 → P6 → P8 for the blueprint and its voice
     * clips, with P7 hanging off P5 alone. Awaiting the challenges next to the
     * blueprint made P8 wait for them too, so a slow challenge round delayed
     * work that had nothing to do with it — on the run that prompted this, the
     * blueprint was ready at 56s and voice synthesis did not start until 120s.
     *
     * Neither set rejects: both use allSettled internally and return a possibly
     * empty set, so this promise cannot become an unhandled rejection while the
     * blueprint is still being built.
     */
    await publishProgress(
      supabase,
      sessionId,
      'blueprint',
      codingCount > 0 || skillCount > 0
        ? `questions + ${codingCount} coding, ${skillCount} skill`
        : undefined,
      clock,
    );

    const challenges = Promise.all([
      codingCount > 0
        ? runCodingChallengeSet(challengeInput, codingCount, context)
        : Promise.resolve(null),
      skillCount > 0
        ? runSkillChallengeSet(challengeInput, skillCount, context)
        : Promise.resolve(null),
    ]);

    const blueprint = await runBlueprint(
      {
        strategy,
        gap: project.gap_report as GapReport,
        resume: resumeProfile,
        // The live interviewer never sees the JD; P6 digests it into the
        // blueprint's context block, which is read on every turn instead.
        jd,
        company: project.company_profile as CompanyProfile | null,
        roleTitle: project.role_title,
        companyName: project.company_name,
        seniority: project.seniority ?? 'mid',
        difficulty: config.difficulty,
        // From the setup screen. P5 already weights them when choosing sections;
        // P6 needs them too, or the section that was planned around a focus
        // skill gets its goals written about something else.
        focusSkills: config.focus_skills,
      },
      context,
    );

    // ── P8, alongside whatever P7 is still doing ─────────────────────────────
    await publishProgress(supabase, sessionId, 'voice', undefined, clock);

    const [voiceAssets, [codingChallenge, skillChallenge]] = await Promise.all([
      presynthesizeVoice(supabase, {
        sessionId,
        userId: session.user_id,
        blueprint,
        config,
      }),
      challenges,
    ]);

    /*
     * A module that was paid for and produced nothing must not leave its
     * section in the blueprint.
     *
     * When challenge generation fails entirely, `skillPayload` returns null and
     * the editor never opens — so the interviewer would hand off to a screen
     * that never appears, then talk into a section with nothing in it. Dropping
     * the section turns a broken round into a shorter interview, which is the
     * better of the two.
     *
     * Logged at error level because the user was charged a flat module fee for
     * this and did not get it.
     */
    const emptyModules = new Set<string>();
    if (codingCount > 0 && !codingChallenge?.challenges.length) emptyModules.add('coding');
    if (skillCount > 0 && !skillChallenge?.challenges.length) emptyModules.add('skill_challenge');

    if (emptyModules.size > 0) {
      console.error(
        `[session-prep] ${sessionId} — PAID MODULE PRODUCED NOTHING: ${[...emptyModules].join(', ')}. ` +
          'Section dropped from the blueprint.',
      );
      const kept = blueprint.sections.filter((s) => !emptyModules.has(s.type));
      // Defensive: the intro and closing are always present, so this cannot
      // realistically bite — but an interview with one section left is not an
      // interview, and a broken handoff is the lesser problem at that point.
      if (kept.length >= 2) blueprint.sections = kept;
    }

    // L3 is seeded from P6's evidence contract, and the runtime starts at the
    // strategy's opening difficulty. Both are checkpointed into live_state so a
    // dropped connection resumes rather than restarts.
    const coverage = seedCoverage(sessionId, blueprint);
    const runtime = initialRuntime(
      blueprint.sections[0]?.section_id ?? 'sec_1',
      strategy.difficulty_curve.start_level,
    );

    await supabase
      .from('sessions')
      .update({
        status: 'ready',
        blueprint,
        coding_challenge: codingChallenge,
        skill_challenge: skillChallenge,
        voice_assets: voiceAssets,
        live_state: {
          v: 2,
          runtime,
          coverage,
          memory: emptyMemory(sessionId),
          questions: [],
          strategy,
        },
        error: null,
      })
      .eq('id', sessionId);

    console.info(
      `[session-prep] ${sessionId} → ready [${((Date.now() - clock.startedAt) / 1000).toFixed(1)}s total, ` +
        `${voiceAssets.assets.length} clips cached]`,
    );

    return { status: 'ready', voiceAssetsCached: voiceAssets.assets.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Session preparation failed.';
    return await failSession(supabase, sessionId, message);
  }
}

// ── P8 · Voice Asset Pre-synthesis ───────────────────────────────────────────

export interface VoiceAssetIndex {
  v: 2;
  voice: string;
  assets: Array<{
    asset_id: string;
    /** The exact text this clip says. A clip is played ONLY on an exact match. */
    text: string;
    path: string;
    kind: 'bank_question' | 'transition' | 'acknowledgement';
  }>;
}

/**
 * Renders every bank question, transition and acknowledgement to audio before
 * the interview starts. This is what turns most live turns into a cache lookup
 * instead of a synthesis call — roughly 60-70% hit rate, which is what pays for
 * the second blocking model call D2/D3 added.
 *
 * Failure is non-fatal: a cold cache costs latency, not correctness.
 */
async function presynthesizeVoice(
  supabase: SupabaseClient,
  args: {
    sessionId: string;
    userId: string;
    blueprint: Blueprint;
    config: SessionConfig;
  },
): Promise<VoiceAssetIndex> {
  const voice = voiceForPersona(args.config.persona);
  const index: VoiceAssetIndex = { v: 2, voice, assets: [] };

  const targets: Array<{ id: string; text: string; kind: VoiceAssetIndex['assets'][number]['kind'] }> = [];

  args.blueprint.sections.forEach((section, si) => {
    section.entry_transitions.forEach((t, i) =>
      targets.push({ id: `tr_in_${si}_${i}`, text: t, kind: 'transition' }),
    );
    section.exit_transitions.forEach((t, i) =>
      targets.push({ id: `tr_out_${si}_${i}`, text: t, kind: 'transition' }),
    );
    /*
     * Only the FIRST seed question of each goal.
     *
     * Invariant 17 plays a cached clip only on an exact text match, and the
     * live interviewer writes its own wording — so a seed is spoken verbatim
     * in two situations only: it opens a goal, or the live call failed and the
     * rule layer fell back to it. The second and third seeds of a goal are
     * almost never the thing that gets said, and synthesising all of them was
     * roughly forty-five clips per session generated, uploaded and then never
     * read. A miss costs a streamed clip, not a broken turn.
     */
    section.goals.forEach((goal) => {
      const opener = goal.question_bank[0];
      if (opener) {
        targets.push({ id: `q_${opener.bank_id}`, text: opener.text, kind: 'bank_question' });
      }
    });
  });

  ACKNOWLEDGEMENT_POOL.forEach((a, i) =>
    targets.push({ id: `ack_${i}`, text: a, kind: 'acknowledgement' }),
  );

  /*
   * Bounded concurrency: an unbounded burst gets rate-limited, and P8 must
   * finish before READY.
   *
   * Raised from 6 to 10 because each unit of work is a TTS call followed by a
   * storage upload — entirely I/O, with nothing of ours doing any work in
   * between. Twenty-six clips at six-wide is five sequential batches and was
   * costing ~35s of the critical path; ten-wide is three.
   */
  const CONCURRENCY = 10;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (t) => {
        const { audio, mediaType } = await synthesizeUtterance(t.text, {
          voice,
          context: { userId: args.userId, sessionId: args.sessionId },
        });
        const path = `${args.userId}/${args.sessionId}/${t.id}.mp3`;

        const { error } = await supabase.storage
          .from('voice')
          .upload(path, audio, { contentType: mediaType, upsert: true });
        if (error) throw error;

        return { asset_id: t.id, text: t.text, path, kind: t.kind };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') index.assets.push(r.value);
    }
  }

  return index;
}

async function failSession(
  supabase: SupabaseClient,
  sessionId: string,
  message: string,
): Promise<SessionPrepResult> {
  await supabase
    .from('sessions')
    .update({
      status: 'failed',
      error: { stage: 'session_prep', message, at: new Date().toISOString() },
    })
    .eq('id', sessionId);

  return { status: 'failed', error: message, voiceAssetsCached: 0 };
}
