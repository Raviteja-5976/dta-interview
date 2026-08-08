/**
 * Phase 1 (session half) · P5' → P6 → P7 → P8.
 *
 * Runs per session and takes seconds rather than the ~60s of project prep,
 * because P1–P4 already ran once and are reused. That is the entire payoff of
 * the project/session split.
 *
 * P5 re-runs here rather than being reused from the project. Time allocation and
 * the difficulty ramp depend on the duration, difficulty and modules the user
 * picked on the setup screen, and those are session choices — a strategy built
 * for a 15-minute no-coding default is the wrong envelope for a 45-minute
 * session with a coding round. It is a small `balanced` call, and getting the
 * section budgets right is worth more than saving it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { runStrategy } from '../agents/p5-strategy';
import { runBlueprint } from '../agents/p6-blueprint';
import { runCodingChallengeSet, runDesignChallengeSet } from '../agents/p7-challenge';
import { codingQuestionCount, designQuestionCount } from '../credits';
import type {
  Blueprint,
  CompanyProfile,
  GapReport,
  JdProfile,
  ResumeProfile,
} from '../agents/schemas';
import { synthesizeUtterance } from '../ai/voice';
import { ACKNOWLEDGEMENT_POOL } from '../engine/rules';
import { seedCoverage } from '../engine/l3-evidence';
import { emptyMemory } from '../engine/l2-memory-store';
import { initialRuntime } from '../engine/types';

export interface SessionConfig {
  difficulty: 'easy' | 'medium' | 'hard';
  duration_min: number;
  language: string;
  persona: string;
  modules: { coding: boolean; system_design: boolean; behavioral: boolean };
  focus_skills: string[];
}

export interface SessionPrepResult {
  status: 'ready' | 'failed';
  error?: string;
  voiceAssetsCached: number;
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

  try {
    await supabase.from('sessions').update({ status: 'preparing' }).eq('id', sessionId);

    // ── P5' ──────────────────────────────────────────────────────────────────
    const strategy = await runStrategy(
      {
        gap: project.gap_report as GapReport,
        jd: project.jd_profile as JdProfile,
        config: {
          durationMin: config.duration_min,
          difficulty: config.difficulty,
          coding: config.modules.coding,
          systemDesign: config.modules.system_design,
          focusSkills: config.focus_skills,
        },
      },
      context,
    );

    // ── P6 ───────────────────────────────────────────────────────────────────
    const blueprint = await runBlueprint(
      {
        strategy,
        gap: project.gap_report as GapReport,
        resume: resumeProfile,
        company: project.company_profile as CompanyProfile | null,
        roleTitle: project.role_title,
        companyName: project.company_name,
        seniority: project.seniority ?? 'mid',
        difficulty: config.difficulty,
      },
      context,
    );

    // ── P7 (only for enabled modules) ────────────────────────────────────────
    const challengeInput = {
      roleTitle: project.role_title,
      seniority: project.seniority ?? 'mid',
      prioritySkills: strategy.priority_skills,
      difficulty: config.difficulty,
      strategy,
    };

    // How many challenges each module carries. The fee is flat, the count is
    // not: difficulty sets the ambition and duration sets what physically fits,
    // capped at three either way.
    const codingCount = config.modules.coding
      ? codingQuestionCount(config.difficulty, config.duration_min)
      : 0;
    const designCount = config.modules.system_design
      ? designQuestionCount(config.difficulty, config.duration_min)
      : 0;

    const [codingChallenge, designChallenge] = await Promise.all([
      codingCount > 0
        ? runCodingChallengeSet(challengeInput, codingCount, context)
        : Promise.resolve(null),
      designCount > 0
        ? runDesignChallengeSet(challengeInput, designCount, context)
        : Promise.resolve(null),
    ]);

    // ── P8 ───────────────────────────────────────────────────────────────────
    const voiceAssets = await presynthesizeVoice(supabase, {
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
        design_challenge: designChallenge,
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
    section.goals.forEach((goal) => {
      goal.question_bank.forEach((q) =>
        targets.push({ id: `q_${q.bank_id}`, text: q.text, kind: 'bank_question' }),
      );
      goal.followup_bank.forEach((f) =>
        targets.push({ id: `f_${f.followup_id}`, text: f.text, kind: 'bank_question' }),
      );
    });
  });

  ACKNOWLEDGEMENT_POOL.forEach((a, i) =>
    targets.push({ id: `ack_${i}`, text: a, kind: 'acknowledgement' }),
  );

  // Bounded concurrency: a 40-clip burst at full parallelism gets rate-limited,
  // and P8 must finish before READY.
  const CONCURRENCY = 6;
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

function voiceForPersona(persona: string): string {
  switch (persona) {
    case 'warm_professional':
      return 'alloy';
    case 'direct':
      return 'onyx';
    case 'friendly':
      return 'nova';
    default:
      return 'alloy';
  }
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
