/**
 * Phase 1 (session half) · P5' → (P6 ∥ P7) → the opening clip.
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
 *
 * ── How it runs ──────────────────────────────────────────────────────────────
 * As a durable pipeline (lib/ai/durable.ts), one short pass per request from
 * POST /api/sessions/[id]/prep. Every pass executes this function from the top,
 * replaying finished calls from the run's state, so nothing is written to the
 * session until the pass with every result in hand.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { alignModuleSections, runStrategy } from '../agents/p5-strategy';
import { openingSeed, runBlueprint } from '../agents/p6-blueprint';
import { runCodingChallengeSet, runSkillChallengeSet } from '../agents/p7-challenge';
import { codingQuestionCount, skillQuestionCount } from '../credits';
import type {
  Blueprint,
  CompanyProfile,
  GapReport,
  JdProfile,
  ResumeProfile,
} from '../agents/schemas';
import { checkpoint, reportProgress, rethrowIfPending } from '../ai/durable';
import { synthesizeUtterance, voiceForPersona } from '../ai/voice';
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

/** Typed so a stage name that does not exist cannot be reported. */
function stageReached(stage: SessionPrepStage, detail?: string): void {
  reportProgress(stage, detail);
}

/**
 * Publishes progress to `sessions.progress`, which the interview screen watches
 * over realtime.
 *
 * Prep is tens of seconds of genuine work. Without this the screen has nothing
 * to show and a slow-but-healthy prep is indistinguishable from a hang — which
 * is exactly how a working system gets reported as broken.
 *
 * Called by the prep route when a pass moves the stage on, never from inside
 * the pipeline: the pipeline re-runs from the top on every pass, and writing
 * from there would walk the bar back to the first stage each time.
 *
 * Never allowed to fail anything: a missed progress write costs a UI update.
 */
export async function publishSessionProgress(
  supabase: SupabaseClient,
  sessionId: string,
  stage: string,
  detail: string | null,
): Promise<void> {
  const index = SESSION_PREP_STAGES.findIndex((s) => s.key === stage);
  if (index === -1) return;

  await supabase
    .from('sessions')
    .update({
      progress: {
        stage,
        index,
        total: SESSION_PREP_STAGES.length,
        detail,
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
    .select('id, user_id, project_id, status, config')
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

  try {
    // Every pass reaches this line; only the first needs to write it.
    if (session.status !== 'preparing') {
      await supabase.from('sessions').update({ status: 'preparing' }).eq('id', sessionId);
    }
    stageReached('strategy');

    // ── P5' ──────────────────────────────────────────────────────────────────
    const planned = await runStrategy(
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

    // Every module that was bought has its section, and none that was not.
    // Everything downstream — P6, P7, the live runtime — reads this version.
    const strategy = alignModuleSections(planned, {
      coding: config.modules.coding,
      skillChallenge: config.modules.skill_challenge,
    });

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
      // A focus skill the task can be set in leads the skill round's slots.
      focusSkills: config.focus_skills,
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

    stageReached(
      'blueprint',
      codingCount > 0 || skillCount > 0
        ? `questions + ${codingCount} coding, ${skillCount} skill`
        : undefined,
    );

    // ── P6 and P7, concurrently ──────────────────────────────────────────────
    //
    // P7 reads the strategy, the JD and the config. It has never read the
    // blueprint, so waiting for one before starting the other was pure serial
    // latency — on a session with both modules enabled that was the coding and
    // skill challenges, up to six deep-tier calls, queued behind the single
    // slowest thing in preparation for no reason at all.
    //
    // `allSettled`, so that every one of them is started or checked on every
    // pass before the pass decides anything (durable.ts, rule 3).
    const [blueprintOutcome, codingOutcome, skillOutcome] = await Promise.allSettled([
      runBlueprint(
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
          // From the setup screen. P5 already weights them when choosing
          // sections; P6 needs them too, or the section that was planned around
          // a focus skill gets its goals written about something else.
          focusSkills: config.focus_skills,
        },
        context,
      ),
      codingCount > 0
        ? runCodingChallengeSet(challengeInput, codingCount, context)
        : Promise.resolve(null),
      skillCount > 0
        ? runSkillChallengeSet(challengeInput, skillCount, context)
        : Promise.resolve(null),
    ]);
    checkpoint();

    if (blueprintOutcome.status === 'rejected') throw blueprintOutcome.reason;
    const blueprint = blueprintOutcome.value;

    // Neither set rejects on a failed challenge — both collect with allSettled
    // and return a possibly empty set. Anything that does reject is treated as
    // the module producing nothing, which the block below turns into a shorter
    // interview rather than a failed one.
    if (codingOutcome.status === 'rejected') {
      console.error(`[session-prep] ${sessionId} coding set failed`, codingOutcome.reason);
    }
    if (skillOutcome.status === 'rejected') {
      console.error(`[session-prep] ${sessionId} skill set failed`, skillOutcome.reason);
    }
    const codingChallenge = codingOutcome.status === 'fulfilled' ? codingOutcome.value : null;
    const skillChallenge = skillOutcome.status === 'fulfilled' ? skillOutcome.value : null;

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

    // ── P8 · the opening clip ────────────────────────────────────────────────
    stageReached('voice');
    const voiceAssets = await presynthesizeOpening(supabase, {
      sessionId,
      userId: session.user_id,
      blueprint,
      config,
    });

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
      `[session-prep] ${sessionId} → ready (${voiceAssets.assets.length} opening clip cached)`,
    );

    return { status: 'ready', voiceAssetsCached: voiceAssets.assets.length };
  } catch (err) {
    // Unfinished work is not a failure — the next pass picks it up.
    rethrowIfPending(err);

    const message = err instanceof Error ? err.message : 'Session preparation failed.';
    return await failSession(supabase, sessionId, message);
  }
}

// ── P8 · The opening clip ────────────────────────────────────────────────────

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
 * Renders the ONE line certain to be said: the warm-up's opening question,
 * which the opening turn speaks verbatim (`openingTurn` in turn.ts). About a
 * second of work.
 *
 * ── Why only one ─────────────────────────────────────────────────────────────
 * This used to render every transition, each goal's opening seed and the whole
 * acknowledgement pool — 20 to 40 clips, each a TTS call plus a Storage upload
 * — and the session could not go READY until all of them had. That was one to
 * two minutes of the prep the candidate sat and watched, for clips that mostly
 * never played: the live interviewer writes its own wording, and a clip plays
 * only on an exact text match.
 *
 * Everything else streams from /api/sessions/[id]/speak as it is said, which is
 * what the turn route already does on any cache miss. The first line is the one
 * worth having ready, because it plays the moment the candidate presses start
 * with nothing before it to hide a synthesis behind.
 *
 * Failure is non-fatal: without the clip, the first line streams as well.
 */
async function presynthesizeOpening(
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

  const opener = openingSeed(args.blueprint.sections[0]);
  if (!opener) return index;

  try {
    const { audio, mediaType } = await synthesizeUtterance(opener.text, {
      voice,
      context: { userId: args.userId, sessionId: args.sessionId },
    });

    const assetId = `q_${opener.bank_id}`;
    const path = `${args.userId}/${args.sessionId}/${assetId}.mp3`;

    const { error } = await supabase.storage
      .from('voice')
      .upload(path, audio, { contentType: mediaType, upsert: true });
    if (error) throw error;

    index.assets.push({ asset_id: assetId, text: opener.text, path, kind: 'bank_question' });
  } catch (err) {
    console.warn(`[session-prep] ${args.sessionId} opening clip failed — the first line will stream`, err);
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
