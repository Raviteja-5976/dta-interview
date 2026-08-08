/**
 * Phase 3 · Evaluation — E1 → (E2 ∥ E4) → S1 → E5 → E6 → finalize_session.
 *
 * All of it runs post-interview, in batch (D10). Nothing here is on a latency
 * budget, which is why the grading agents can afford the `balanced` tier.
 *
 * The ordering constraint that matters (§2.3): E1 completes before E2/E4,
 * because they both read `question_record[]`. E4 emits observations; S1 emits
 * numbers. E6 reads L3's coverage ledger directly so the report's
 * skill-verification claims come from the live record rather than re-derivation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { runGrading } from '../agents/e4-grading';
import { runRewriteCoach } from '../agents/e5-rewrite';
import { runReportComposer } from '../agents/e6-report';
import type { Blueprint, Grading, SkillOutcome } from '../agents/schemas';
import {
  computeSpeechMetrics,
  fillerTrend,
  summariseSpeech,
  type SpeechMetrics,
} from '../engine/e2-speech';
import {
  aggregateSession,
  computeReadiness,
  scoreQuestion,
  type Readiness,
  type RubricSignal,
  type ScoredQuestion,
} from '../engine/s1-scoring';
import type { QuestionRecord, WordTiming } from '../engine/types';
import type { LiveState } from './turn';

export interface EvaluationResult {
  status: 'complete' | 'failed';
  error?: string;
  overall?: number;
}

export async function runEvaluation(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<EvaluationResult> {
  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, project_id, seq, config, blueprint, live_state, media, started_at, credits_charged')
    .eq('id', sessionId)
    .single();

  if (!session) return { status: 'failed', error: 'Session not found.' };

  const { data: project } = await supabase
    .from('projects')
    .select('id, company_name, role_title, readiness')
    .eq('id', session.project_id)
    .single();

  const blueprint = session.blueprint as Blueprint | null;
  const state = session.live_state as LiveState | null;

  if (!blueprint || !state) {
    return await fail(supabase, sessionId, 'This session has no blueprint or transcript to evaluate.');
  }

  const config = session.config as { language?: string };
  const language = config.language ?? 'en-IN';
  const context = { userId: session.user_id, projectId: session.project_id, sessionId };

  try {
    await supabase.from('sessions').update({ status: 'processing' }).eq('id', sessionId);

    // ── E1 · Transcript assembly ─────────────────────────────────────────────
    const answered = state.questions.filter(
      (q): q is QuestionRecord & { answer: NonNullable<QuestionRecord['answer']> } =>
        Boolean(q.answer?.transcript?.trim()),
    );

    if (answered.length === 0) {
      return await fail(supabase, sessionId, 'No answers were recorded in this session.');
    }

    const wordsBySeq = await loadWordTimings(supabase, session.user_id, sessionId, answered);

    // ── E2 · Speech metrics · deterministic, parallel-free ───────────────────
    const metricsBySeq = new Map<number, SpeechMetrics>();
    for (const q of answered) {
      const words = wordsBySeq.get(q.seq) ?? synthesizeWordTimings(q);
      metricsBySeq.set(
        q.seq,
        computeSpeechMetrics(words, {
          silenceBeforeMs: q.answer.silence_before_answer_ms,
          asrConfidenceAvg: q.answer.asr_confidence_avg,
        }),
      );
    }

    // ── E4 · Grading · map-reduce, one call per question ─────────────────────
    const gradings = await mapWithConcurrency(answered, 5, async (q) =>
      runGrading(
        {
          question: q,
          rubric: q.rubric ?? { expected_signals: [] },
          gradingMode: q.grading_mode,
          transcript: q.answer.transcript,
          partiallyHeard: q.partially_heard,
          asrConfidence: q.answer.asr_confidence_avg,
        },
        context,
      ),
    );

    // ── S1 · Scoring · deterministic ─────────────────────────────────────────
    const scored: ScoredQuestion[] = answered.map((q, i) => {
      const grading = gradings[i];
      const metrics = metricsBySeq.get(q.seq)!;
      const signals = extractSignals(q);

      const scores = scoreQuestion({
        mode: q.grading_mode,
        grading,
        signals,
        metrics,
        language,
        partiallyHeard: q.partially_heard,
      });

      return {
        seq: q.seq,
        goalId: q.goal_id,
        sectionId: q.section_id,
        weight: q.weight,
        scores,
        // Ungraded and low-reliability questions are excluded from all
        // denominators (§9.6) — never scored as zero.
        excluded: signals.length === 0 && q.grading_mode === 'factual',
      };
    });

    const sessionScores = aggregateSession(scored, state.coverage, blueprint);

    // ── E5 · Rewrites · parallel ─────────────────────────────────────────────
    const rewrites = await mapWithConcurrency(answered, 4, async (q, i) =>
      runRewriteCoach(
        {
          questionText: q.text,
          transcript: q.answer.transcript,
          grading: gradings[i],
          gradingMode: q.grading_mode,
          roleTitle: project?.role_title ?? 'this role',
        },
        context,
      ).catch(() => null),
    );

    // ── Speech rollup ────────────────────────────────────────────────────────
    const perQuestionMetrics = answered.map((q) => ({ seq: q.seq, metrics: metricsBySeq.get(q.seq)! }));
    const speechSummary = {
      ...summariseSpeech(perQuestionMetrics, language),
      trend: fillerTrend(perQuestionMetrics),
    };

    // ── E6 · Report narrative ────────────────────────────────────────────────
    const previousOverall = await loadPreviousOverall(supabase, session.project_id, session.seq);

    const narrative = await runReportComposer(
      {
        scores: sessionScores,
        coverage: state.coverage,
        blueprint,
        roleTitle: project?.role_title ?? 'this role',
        companyName: project?.company_name ?? 'the company',
        questions: answered.map((q, i) => ({
          seq: q.seq,
          text: q.text,
          transcript: q.answer.transcript.slice(0, 1200),
          accuracy: scored[i].scores.primary,
          oneThingToChange: gradings[i].one_thing_to_change,
          covered: gradings[i].concept_coverage.filter((c) => c.status === 'covered').length,
          total: gradings[i].concept_coverage.length,
        })),
        speechSummary: {
          wpm: speechSummary.wpm,
          fillerRate: speechSummary.filler_rate,
          longPausesPerMin: speechSummary.long_pauses_per_min,
          reliability: speechSummary.excluded_questions.length > answered.length / 2 ? 'low' : 'ok',
          trend: speechSummary.trend,
        },
        previousOverall,
      },
      context,
    );

    // ── Persist per-question rows ────────────────────────────────────────────
    await writeSessionQuestions(supabase, {
      sessionId,
      userId: session.user_id,
      questions: answered,
      gradings,
      rewrites,
      metrics: metricsBySeq,
      scored,
    });

    // ── Rollups ──────────────────────────────────────────────────────────────
    const readiness = computeReadiness({
      scores: sessionScores,
      previous: (project?.readiness as Readiness | null) ?? null,
      sessionId,
    });

    const skills = deriveSkillOutcomes(state, blueprint, scored);

    const report = {
      ...narrative,
      v: 2 as const,
      generated_at: new Date().toISOString(),
      question_count: answered.length,
    };

    // ── finalize_session · one transaction ───────────────────────────────────
    // Called with the service-role client. It is `security definer` and performs
    // no ownership check of its own, so it must never be reachable from a
    // browser session — see supabase/migrations/013_harden.sql.
    const { error: finalizeError } = await supabase.rpc('finalize_session', {
      p_session_id: sessionId,
      p_scores: sessionScores,
      p_report: report,
      p_speech: speechSummary,
      p_readiness: readiness,
      p_skills: skills,
    });

    if (finalizeError) {
      return await fail(supabase, sessionId, `Could not finalise the session: ${finalizeError.message}`);
    }

    return { status: 'complete', overall: sessionScores.overall };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Evaluation failed.';
    return await fail(supabase, sessionId, message);
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

function extractSignals(question: QuestionRecord): RubricSignal[] {
  const rubric = question.rubric as { expected_signals?: RubricSignal[] } | undefined;
  return rubric?.expected_signals ?? [];
}

/**
 * Word arrays live in Storage, not Postgres (db-design.md §1.6): ~2,000 words ×
 * 4 fields per session, read once by E2 and then effectively never.
 */
async function loadWordTimings(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  questions: QuestionRecord[],
): Promise<Map<number, WordTiming[]>> {
  const out = new Map<number, WordTiming[]>();

  await Promise.all(
    questions.map(async (q) => {
      if (q.answer?.words?.length) {
        out.set(q.seq, q.answer.words);
        return;
      }
      const path = q.answer?.words_url ?? `${userId}/${sessionId}/q_${q.seq}.json`;
      const { data } = await supabase.storage.from('transcripts').download(path);
      if (!data) return;
      try {
        out.set(q.seq, JSON.parse(await data.text()) as WordTiming[]);
      } catch {
        /* fall through to the estimate */
      }
    }),
  );

  return out;
}

/**
 * Last resort when word timings are unavailable. Produces evenly-spaced timings
 * so pace is roughly right but pause and repetition detection are meaningless —
 * which is why every question built this way is marked low-reliability and drops
 * out of the aggregates rather than quietly polluting them.
 */
function synthesizeWordTimings(
  question: QuestionRecord & { answer: NonNullable<QuestionRecord['answer']> },
): WordTiming[] {
  const words = question.answer.transcript.split(/\s+/).filter(Boolean);
  const span = Math.max(1, question.answer.end_ms - question.answer.start_ms);
  const per = span / Math.max(1, words.length);

  return words.map((w, i) => ({
    w,
    s: Math.round(question.answer.start_ms + i * per),
    e: Math.round(question.answer.start_ms + (i + 1) * per),
    // Marks the whole answer unreliable in E2, which is the honest outcome.
    conf: 0.5,
  }));
}

async function loadPreviousOverall(
  supabase: SupabaseClient,
  projectId: string,
  currentSeq: number,
): Promise<number | null> {
  const { data } = await supabase
    .from('sessions')
    .select('overall_score')
    .eq('project_id', projectId)
    .eq('status', 'complete')
    .lt('seq', currentSeq)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.overall_score ?? null;
}

async function writeSessionQuestions(
  supabase: SupabaseClient,
  args: {
    sessionId: string;
    userId: string;
    questions: Array<QuestionRecord & { answer: NonNullable<QuestionRecord['answer']> }>;
    gradings: Grading[];
    rewrites: Array<Awaited<ReturnType<typeof runRewriteCoach>> | null>;
    metrics: Map<number, SpeechMetrics>;
    scored: ScoredQuestion[];
  },
): Promise<void> {
  const rows = args.questions.map((q, i) => ({
    user_id: args.userId,
    session_id: args.sessionId,
    seq: q.seq,
    question: {
      text: q.text,
      as_spoken: q.as_spoken,
      goal_id: q.goal_id,
      bank_id: q.bank_id,
      origin: q.origin,
      difficulty: q.difficulty,
      targets_evidence: q.targets_evidence,
      rubric: q.rubric,
      intent_snapshot: q.intent_snapshot,
      utterance_plan: q.utterance_plan,
      partially_heard: q.partially_heard ?? false,
    },
    answer: q.answer,
    metrics: args.metrics.get(q.seq) ?? null,
    grading: args.gradings[i],
    rewrite: args.rewrites[i],
    scores: {
      accuracy: args.scored[i].scores.accuracy,
      depth: args.scored[i].scores.depth,
      behavioral: args.scored[i].scores.behavioral,
      fluency: args.scored[i].scores.fluency,
      primary: args.scored[i].scores.primary,
    },
    // Duplicated out of `question` as a real text[] because a GIN index on an
    // array is the cheap way to answer "every question that touched Redis"
    // (db-design.md §3.6). This is the one intentional duplication in the schema.
    skill_tags: q.skill_tags,
    grading_mode: q.grading_mode,
    status: 'graded',
  }));

  await supabase.from('session_questions').upsert(rows, { onConflict: 'session_id,seq' });
}

/**
 * Per-skill outcomes for `finalize_session(p_skills)`. Sourced from L3's live
 * coverage ledger rather than re-derived, so what the report claims was verified
 * is exactly what the interview actually established.
 */
function deriveSkillOutcomes(
  state: LiveState,
  blueprint: Blueprint,
  scored: ScoredQuestion[],
): SkillOutcome[] {
  const bySkill = new Map<string, { scores: number[]; confidence: number[]; depth: string }>();

  for (const section of blueprint.sections) {
    for (const goal of section.goals) {
      const coverage = state.coverage.goals.find((g) => g.goal_id === goal.goal_id);
      if (!coverage) continue;

      const goalScores = scored.filter((s) => s.goalId === goal.goal_id && !s.excluded);
      if (goalScores.length === 0) continue;

      for (const skill of goal.skill_tags) {
        const entry = bySkill.get(skill) ?? { scores: [], confidence: [], depth: 'surface' };
        entry.scores.push(...goalScores.map((s) => s.scores.primary));
        entry.confidence.push(coverage.confidence);
        entry.depth = coverage.depth_reached;
        bySkill.set(skill, entry);
      }
    }
  }

  return [...bySkill.entries()].map(([skill, e]) => {
    const score = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
    const confidence = e.confidence.reduce((a, b) => a + b, 0) / e.confidence.length;

    return {
      skill,
      status: score >= 7 ? 'STRONG' : score >= 5 ? 'WEAK' : confidence < 0.3 ? 'UNVERIFIED' : 'WEAK',
      score: Math.round(score * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      depth: e.depth as SkillOutcome['depth'],
      // Carried forward by finalize_session's coalesce, so the seeded P4 value
      // survives rather than being overwritten with nothing.
      jd_importance: null,
    };
  });
}

/** Keeps E4/E5 fan-out from tripping provider rate limits. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function fail(
  supabase: SupabaseClient,
  sessionId: string,
  message: string,
): Promise<EvaluationResult> {
  await supabase
    .from('sessions')
    .update({
      status: 'failed',
      error: { stage: 'evaluation', message, at: new Date().toISOString() },
    })
    .eq('id', sessionId);

  // A failed evaluation must never silently consume a credit
  // (sitemap-workflow.md §10). The refund is issued by the caller, which owns
  // the ledger write.
  return { status: 'failed', error: message };
}
