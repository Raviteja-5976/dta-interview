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
import { runSkillValidation } from '../agents/sv-validate';
import type { ChallengeSet } from '../agents/p7-challenge';
import type {
  Blueprint,
  Grading,
  SkillChallenge,
  SkillOutcome,
  SkillValidation,
} from '../agents/schemas';
import {
  computeSpeechMetrics,
  computeSpeechMetricsFromText,
  fillerTrend,
  summariseSpeech,
  type SpeechMetrics,
} from '../engine/e2-speech';
import {
  aggregateSession,
  computeReadiness,
  isGradeable,
  scoreQuestion,
  skillRequirementCoverage,
  type EvidenceRollup,
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
    .select(
      'id, user_id, project_id, seq, config, blueprint, live_state, media, started_at, credits_charged, skill_challenge',
    )
    .eq('id', sessionId)
    .single();

  if (!session) return { status: 'failed', error: 'Session not found.' };

  const { data: project } = await supabase
    .from('projects')
    .select('id, company_name, role_title, readiness, active_resume_id')
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
    /*
     * `skipped` is excluded, and that is not the same as having no transcript.
     *
     * A question the candidate answered with a question — "which Spark do you
     * mean?" — carries a real transcript and is marked skipped by the turn,
     * because what they said was a request for clarification and not an answer.
     * Grading it would mark them down for a question they never got a clear
     * version of, and the interviewer re-asked it properly on the next turn.
     */
    const answered = state.questions.filter(
      (q): q is QuestionRecord & { answer: NonNullable<QuestionRecord['answer']> } =>
        q.status !== 'skipped' && Boolean(q.answer?.transcript?.trim()),
    );

    if (answered.length === 0) {
      return await fail(supabase, sessionId, 'No answers were recorded in this session.');
    }

    const wordsBySeq = await loadWordTimings(supabase, session.user_id, sessionId, answered);

    // What the candidate claimed on paper, for grading experiential answers
    // against something. Loaded once and shared across all ~15 E4 calls.
    const resumeContext = await loadResumeContext(supabase, project?.active_resume_id ?? null);

    // Sandbox results, keyed to the question the submission was recorded against.
    const codingBySeq = mapCodingSubmissions(state, answered);

    /*
     * ── SV · Skill challenge review ──────────────────────────────────────────
     *
     * Started here, before E4, and awaited after it. Nothing in the two depends
     * on the other, and SV is the slowest call in the pipeline — deep tier, high
     * reasoning effort, up to three of them — so running it alongside ~15 E4
     * calls costs no wall clock at all rather than adding half a minute to
     * every evaluation that bought the module.
     */
    const skillReviewPromise = reviewSkillSubmissions(
      state,
      answered,
      session.skill_challenge as ChallengeSet<SkillChallenge> | null,
      context,
    );

    // ── E2 · Speech metrics · deterministic, parallel-free ───────────────────
    const metricsBySeq = new Map<number, SpeechMetrics>();
    for (const q of answered) {
      const words = wordsBySeq.get(q.seq);

      /*
       * Two paths, and the first one is now the ordinary case again.
       *
       * With words: the full metric set including the pause profile. Deepgram's
       * nova-3 returns per-word timing from the live socket that transcribed
       * the answer, so this is what a session recorded on the current stack
       * lands on (invariant 16 — the timing comes from the live STT, not a
       * second pass).
       *
       * Without: transcript plus the speech window the client measured from the
       * microphone. Pace, fillers and repetition are all real; pause metrics are
       * reported as unavailable and S1 renormalises around them. This covers
       * sessions recorded before the move to Deepgram, and answers where the
       * live socket never opened.
       */
      metricsBySeq.set(
        q.seq,
        words?.length
          ? computeSpeechMetrics(words, {
              silenceBeforeMs: q.answer.silence_before_answer_ms,
              asrConfidenceAvg: q.answer.asr_confidence_avg,
            })
          : computeSpeechMetricsFromText(
              q.answer.transcript,
              // The client-measured window, in seconds.
              Math.max(0, q.answer.end_ms - q.answer.start_ms) / 1000,
              { silenceBeforeMs: q.answer.silence_before_answer_ms },
            ),
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
          // Only where it can change the reading. A factual question has a
          // correct answer; the resume is irrelevant to it and would be prompt
          // weight on every one of these calls.
          resumeContext:
            q.grading_mode === 'experiential' || q.grading_mode === 'behavioral'
              ? resumeContext
              : undefined,
          codingContext: codingBySeq.get(q.seq),
          skillContext: skillContextFor(q, state, answered),
        },
        context,
      ),
    );

    // Collected now that the grading fan-out is done. Empty when the module was
    // not bought, or when nothing was submitted.
    const skillBySeq = await skillReviewPromise;

    // ── S1 · Scoring · deterministic ─────────────────────────────────────────
    const scored: ScoredQuestion[] = answered.map((q, i) => {
      const grading = gradings[i];
      const metrics = metricsBySeq.get(q.seq)!;
      const signals = extractSignals(q);

      const submission = codingBySeq.get(q.seq);
      const skillReview = skillBySeq.get(q.seq);

      /*
       * Requirement coverage is computed here, in code, from SV's per-
       * requirement verdicts and P7's plan-time weights — the skill round's
       * answer to the sandbox pass rate, and the reason two candidates who met
       * the same requirements get the same number however differently they
       * phrased their code.
       *
       * Null when SV returned no verdicts at all, which reads as "not scored"
       * rather than as zero (§9.6).
       */
      const coverage = skillReview ? skillRequirementCoverage(skillReview.outcomes) : null;

      const scores = scoreQuestion({
        mode: q.grading_mode,
        grading,
        signals,
        metrics,
        language,
        partiallyHeard: q.partially_heard,
        /*
         * §9.5: the pass rate is measured, the other three are judged. Without
         * this the coding branch fell through to `scoreDepth`, so the Judge0
         * run — the entire point of the sandbox — contributed nothing to the
         * score, and a candidate whose code passed every test scored the same as
         * one whose code did not compile.
         */
        coding:
          submission && grading.coding
            ? {
                testPassRate: submission.total > 0 ? submission.passed / submission.total : 0,
                complexityMatch: grading.coding.complexity_match,
                codeQuality: grading.coding.code_quality,
                verbalReasoning: grading.coding.verbal_reasoning,
              }
            : undefined,
        /*
         * Four inputs from three sources, and that split is the point: the
         * coverage is arithmetic, correctness and quality are SV's reading of
         * the artifact, and verbal reasoning is E4's reading of the transcript.
         * No single model is asked to be the whole grader.
         */
        skill:
          skillReview && coverage !== null
            ? {
                requirementCoverage: coverage,
                correctness: skillReview.validation.correctness,
                codeQuality: skillReview.validation.code_quality,
                // E4 fills the `coding` block for skill answers too. Zero when
                // it did not, which is the right reading: no evidence they
                // talked through it.
                verbalReasoning: grading.coding?.verbal_reasoning ?? 0,
              }
            : undefined,
      });

      return {
        seq: q.seq,
        goalId: q.goal_id,
        sectionId: q.section_id,
        weight: q.weight,
        scores,
        /*
         * Ungraded questions are excluded from all denominators (§9.6) — never
         * scored as zero.
         *
         * This used to test `factual` only, which left every experiential
         * question without a rubric scoring a hard 0 and counting. Generated
         * probes, memory callbacks and follow-up-bank entries all arrive with
         * no rubric and all grade as experiential, so an interviewer that
         * probed and called back well produced a WORSE report than one that
         * read the bank straight through. `isGradeable` is the rule for every
         * mode, in one place.
         */
        excluded: !isGradeable({
          mode: q.grading_mode,
          signals,
          hasCodingResult: Boolean(submission),
          hasSkillResult: coverage !== null,
        }),
      };
    });

    const sessionScores = aggregateSession(scored, state.coverage, blueprint, {
      mode: (session.config as { mode?: 'practice' | 'screening' }).mode ?? 'practice',
      // Where each question actually came from, so the report can say whether
      // its question scores are comparable to another session's.
      origins: answered.map((q) => q.origin),
    });

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
        /*
         * Every question the session recorded, not just the answered ones.
         *
         * The per-goal counts must reflect what was ASKED. Filtering to answered
         * questions first would drop a question the candidate skipped or talked
         * over and report its goal as never raised, which is a different — and
         * much worse — statement to make about someone.
         *
         * `displayed_goal` is preferred over `goal_id` because it is what the
         * candidate was actually shown beside the question, and on a handoff it
         * is populated where `goal_id` is not.
         */
        askedGoalIds: state.questions
          .map((q) => q.displayed_goal?.goal_id ?? q.goal_id)
          .filter((id): id is string => Boolean(id)),
        questions: answered.map((q, i) => ({
          seq: q.seq,
          text: q.text,
          transcript: q.answer.transcript.slice(0, 1200),
          // The goal this question was asked in service of, so the narrative
          // can tie a weakness to what the question was reaching for rather
          // than to its wording alone.
          goal: q.displayed_goal?.statement,
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
      skillReviews: skillBySeq,
    });

    // ── Rollups ──────────────────────────────────────────────────────────────
    const readiness = computeReadiness({
      scores: sessionScores,
      previous: (project?.readiness as Readiness | null) ?? null,
      sessionId,
    });

    const skills = deriveSkillOutcomes(state, blueprint, scored, sessionScores.evidence);

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

/**
 * The parts of the resume an answer can actually be checked against.
 *
 * Projects and probe-worthy claims only. The full parsed resume is several
 * thousand tokens of contact details, dates and skill lists that say nothing
 * about whether someone's account of their own work holds up, and this rides on
 * every experiential grading call.
 */
async function loadResumeContext(
  supabase: SupabaseClient,
  resumeId: string | null,
): Promise<string | undefined> {
  if (!resumeId) return undefined;

  const { data } = await supabase.from('resumes').select('parsed').eq('id', resumeId).maybeSingle();
  const parsed = data?.parsed as
    | { projects?: unknown[]; claims_worth_probing?: unknown[]; headline?: string }
    | null;

  if (!parsed) return undefined;

  const digest = {
    headline: parsed.headline,
    projects: parsed.projects,
    claims_worth_probing: parsed.claims_worth_probing,
  };

  const json = JSON.stringify(digest);
  return json.length > 6000 ? `${json.slice(0, 6000)}…` : json;
}

/**
 * Joins each coding submission to the question it was recorded against.
 *
 * The client sends a submission as the ANSWER to whichever question was live
 * when the editor opened, and submissions land in `live_state` in the order they
 * were made. Pairing them with the coding-mode questions in sequence order is
 * what reconnects the sandbox result to the thing being graded.
 */
function mapCodingSubmissions(
  state: LiveState,
  answered: QuestionRecord[],
): Map<number, { passed: number; total: number; language: string; source: string }> {
  const raw = (state as unknown as { coding_submissions?: unknown[] }).coding_submissions;
  const out = new Map<number, { passed: number; total: number; language: string; source: string }>();
  if (!Array.isArray(raw) || raw.length === 0) return out;

  const codingQuestions = answered
    .filter((q) => q.grading_mode === 'coding')
    .sort((a, b) => a.seq - b.seq);

  raw.forEach((entry, i) => {
    const s = entry as { passed?: number; total?: number; language?: string; source?: string };
    const question = codingQuestions[i];
    if (!question || typeof s.passed !== 'number' || typeof s.total !== 'number') return;

    out.set(question.seq, {
      passed: s.passed,
      total: s.total,
      language: s.language ?? 'python',
      source: s.source ?? '',
    });
  });

  return out;
}

/**
 * One skill submission, as recorded by the skill route.
 *
 * `challenge_index` is what joins it back to the task in
 * `sessions.skill_challenge` — the submissions array is append-only and a
 * candidate may submit the same task twice, so position in the array is not the
 * index of the challenge.
 */
interface SkillSubmission {
  challenge_index: number;
  skill: string;
  format: string;
  language: string;
  source: string;
}

function readSkillSubmissions(state: LiveState): SkillSubmission[] {
  const raw = (state as unknown as { skill_submissions?: unknown[] }).skill_submissions;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => entry as Partial<SkillSubmission>)
    .filter((s): s is SkillSubmission => typeof s.source === 'string' && s.source.trim().length > 0)
    .map((s) => ({
      challenge_index: typeof s.challenge_index === 'number' ? s.challenge_index : 0,
      skill: s.skill ?? 'the required skill',
      format: s.format ?? 'implement',
      language: s.language ?? 'text',
      source: s.source,
    }));
}

/**
 * The LAST submission for each challenge, in challenge order.
 *
 * Last, not first: the route appends rather than replaces, so a candidate who
 * submitted, kept working and submitted again has two entries for one task and
 * only the second is the answer they stood behind.
 */
function latestSkillSubmissions(state: LiveState): SkillSubmission[] {
  const byIndex = new Map<number, SkillSubmission>();
  for (const s of readSkillSubmissions(state)) byIndex.set(s.challenge_index, s);
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/**
 * The submission a skill question is graded against, for E4's transcript read.
 *
 * Matched by position among skill-mode questions, the same join
 * `mapCodingSubmissions` uses and for the same reason: the client sends a
 * submission as the answer to whichever question was live when the editor
 * opened.
 */
function skillContextFor(
  question: QuestionRecord,
  state: LiveState,
  /**
   * The graded set, NOT `state.questions`.
   *
   * `reviewSkillSubmissions` counts positions over the same list, and the two
   * must agree: a skipped skill question would shift one basis and not the
   * other, and E4 would then be shown a different submission than SV reviewed
   * for the very same question.
   */
  answered: QuestionRecord[],
): { skill: string; format: string; language: string; source: string } | undefined {
  if (question.grading_mode !== 'skill') return undefined;
  const submissions = latestSkillSubmissions(state);
  if (submissions.length === 0) return undefined;

  // Which skill question this is, counting from the first.
  const skillQuestions = answered
    .filter((q) => q.grading_mode === 'skill')
    .sort((a, b) => a.seq - b.seq);
  const position = skillQuestions.findIndex((q) => q.seq === question.seq);
  const submission = submissions[position];
  if (!submission) return undefined;

  return {
    skill: submission.skill,
    format: submission.format,
    language: submission.language,
    source: submission.source,
  };
}

export interface SkillReview {
  validation: SkillValidation;
  outcomes: Array<{ met: 'yes' | 'partial' | 'no'; weight: number }>;
  skill: string;
  format: string;
}

/**
 * Runs SV over every skill submission and keys the result to the question it
 * was recorded against.
 *
 * Failures are swallowed per submission rather than failing the evaluation.
 * A validator that could not be reached leaves that question out of every
 * denominator — `isGradeable` sees no requirement verdicts and excludes it —
 * which is §9.6's rule and is the honest outcome: the review did not happen,
 * so nothing is claimed about the work. Losing a whole report because one
 * review timed out would be a far worse trade.
 */
async function reviewSkillSubmissions(
  state: LiveState,
  answered: QuestionRecord[],
  set: ChallengeSet<SkillChallenge> | null,
  context: { userId: string; projectId: string; sessionId: string },
): Promise<Map<number, SkillReview>> {
  const out = new Map<number, SkillReview>();

  const submissions = latestSkillSubmissions(state);
  if (submissions.length === 0 || !set?.challenges?.length) return out;

  const skillQuestions = answered
    .filter((q) => q.grading_mode === 'skill')
    .sort((a, b) => a.seq - b.seq);

  const reviews = await Promise.all(
    submissions.map(async (submission, position) => {
      const challenge = set.challenges[submission.challenge_index];
      const question = skillQuestions[position];
      if (!challenge || !question) return null;

      try {
        const validation = await runSkillValidation(
          {
            challenge,
            source: submission.source,
            spokenContext: question.answer?.transcript,
          },
          context,
        );

        /*
         * Joined back to P7's weights by requirement id.
         *
         * A verdict whose id matches nothing in the challenge is dropped rather
         * than given a default weight: SV is asked to echo the ids it was
         * handed, and one it invented is about a requirement that does not
         * exist. Crediting it would let a model inflate coverage by inventing
         * requirements it had already decided were met.
         */
        const byId = new Map(challenge.requirements.map((r) => [r.id, r.weight] as const));
        const outcomes = validation.requirements_met
          .filter((r) => byId.has(r.id))
          .map((r) => ({ met: r.met, weight: byId.get(r.id)! }));

        return { seq: question.seq, review: { validation, outcomes, skill: challenge.skill, format: challenge.format } };
      } catch (err) {
        console.error('[SV] skill validation failed', context.sessionId, err);
        return null;
      }
    }),
  );

  for (const r of reviews) {
    if (r) out.set(r.seq, r.review);
  }

  return out;
}

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
    /** SV's reading of a skill submission, keyed by question seq. Usually empty. */
    skillReviews: Map<number, SkillReview>;
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
    // Its own column, not folded into `grading`: that one is E4's contract, and
    // keeping one agent's output per column is what lets the report say which
    // reader said what.
    skill_review: args.skillReviews.get(q.seq)?.validation ?? null,
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
  evidence: EvidenceRollup,
): SkillOutcome[] {
  const bySkill = new Map<
    string,
    { answerScores: number[]; confidence: number[]; depth: string }
  >();

  for (const section of blueprint.sections) {
    for (const goal of section.goals) {
      const coverage = state.coverage.goals.find((g) => g.goal_id === goal.goal_id);
      if (!coverage) continue;

      const goalScores = scored.filter((s) => s.goalId === goal.goal_id && !s.excluded);

      for (const skill of goal.skill_tags) {
        const entry = bySkill.get(skill) ?? { answerScores: [], confidence: [], depth: 'surface' };
        entry.answerScores.push(...goalScores.map((s) => s.scores.primary));
        entry.confidence.push(coverage.confidence);
        entry.depth = coverage.depth_reached;
        bySkill.set(skill, entry);
      }
    }
  }

  const evidenceBySkill = new Map(evidence.by_skill.map((s) => [s.skill, s]));

  return [...bySkill.entries()]
    .map(([skill, e]) => {
      const covered = evidenceBySkill.get(skill);

      /*
       * ── The skill score is EVIDENCE coverage, not answer quality ───────────
       *
       * `skill_progress` is read across sessions — it is the "Verified" column
       * on the Gap Analysis tab and the thing the report's action plan links
       * into. So it has to mean the same thing in session one and session four.
       *
       * Answer scores do not: once the interviewer writes its own questions,
       * two sessions ask different things and averaging their question scores
       * compares two different measurements. Evidence coverage asks "is this
       * established", which the blueprint fixes once per project and which
       * therefore survives the comparison.
       *
       * Answer quality still decides STRONG vs WEAK below, because coverage
       * says a thing was established and says nothing about how well.
       */
      if (!covered) return null;
      const score = covered.score;

      const answered = e.answerScores.length
        ? e.answerScores.reduce((a, b) => a + b, 0) / e.answerScores.length
        : null;

      const confidence = e.confidence.length
        ? e.confidence.reduce((a, b) => a + b, 0) / e.confidence.length
        : 0;

      // Nothing was established and nothing was asked well enough to tell —
      // reported as unverified rather than as a low score the candidate earned.
      const unverified = covered.verified === 0 && covered.partial === 0;

      const status: SkillOutcome['status'] = unverified
        ? 'UNVERIFIED'
        : (answered ?? score) >= 7 && score >= 6
          ? 'STRONG'
          : 'WEAK';

      return {
        skill,
        status,
        score: Math.round(score * 10) / 10,
        confidence: Math.round(confidence * 100) / 100,
        depth: e.depth as SkillOutcome['depth'],
        // Carried forward by finalize_session's coalesce, so the seeded P4 value
        // survives rather than being overwritten with nothing.
        jd_importance: null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
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
