/**
 * S1 · Scoring Engine — agentdesign.md §9.
 *
 * Deterministic code. Every number in the product is born here (invariant 7).
 * E4 emits observations; this file turns them into scores by formula. That split
 * is what makes scores reproducible and lets the weights be retuned without
 * re-running a single model call.
 *
 * If you change a weight, change it here and nowhere else.
 */

import type { Grading } from '../agents/schemas';
import type { Blueprint } from '../agents/schemas';
import type { Coverage, GradingMode } from './types';
import { bandsFor, type SpeechMetrics, type WpmBands } from './e2-speech';

// ── §9.1 Accuracy (factual mode) ─────────────────────────────────────────────

const CREDIT = { covered: 1.0, partial: 0.5, missing: 0.0 } as const;

/** Any must_have concept missing or incorrect caps accuracy here. */
const MUST_HAVE_CAP = 6.5;
/** An answer to a different question caps here — unless it wasn't fully heard. */
const OFF_TOPIC_CAP = 3.0;

export interface RubricSignal {
  id: string;
  evidence_id: string;
  tier: 'must_have' | 'good_to_have' | 'bonus';
  weight: number;
}

export function scoreAccuracy(
  grading: Grading,
  signals: RubricSignal[],
  opts: { partiallyHeard?: boolean } = {},
): number {
  if (signals.length === 0) return 0;

  let earned = 0;
  let possible = 0;
  let mustHaveMissed = false;

  for (const signal of signals) {
    const observed = grading.concept_coverage.find((c) => c.signal_id === signal.id);
    const status = observed?.status ?? 'missing';

    earned += signal.weight * CREDIT[status];
    possible += signal.weight;

    if (signal.tier === 'must_have' && status === 'missing') mustHaveMissed = true;
  }

  const raw = possible > 0 ? earned / possible : 0;

  const majorErrors = grading.incorrect_claims.filter((c) => c.severity === 'major').length;
  const penalty = Math.min(0.25, 0.1 * majorErrors);
  if (majorErrors > 0) mustHaveMissed = true;

  let accuracy = Math.max(0, raw - penalty) * 10;

  // Guard 1: an answer missing the core idea is not an 8 because it covered the bonuses.
  if (mustHaveMissed) accuracy = Math.min(accuracy, MUST_HAVE_CAP);

  // Guard 2: off-topic. Suspended when the candidate did not hear the question in
  // full — you cannot penalise someone for a question they never heard (§9.1).
  if (!grading.answered_the_question && !opts.partiallyHeard) {
    accuracy = Math.min(accuracy, OFF_TOPIC_CAP);
  }

  return round1(accuracy);
}

// ── §9.2 Depth (experiential mode) ───────────────────────────────────────────

const OWNERSHIP_MULTIPLIER = {
  clear_individual: 1.0,
  team_ambiguous: 0.85,
  observational: 0.7,
  not_applicable: 1.0,
} as const;

const SPECIFICITY_MULTIPLIER = { high: 1.0, medium: 0.9, low: 0.75 } as const;

export function scoreDepth(grading: Grading, signals: RubricSignal[]): number {
  if (signals.length === 0) return 0;

  let earned = 0;
  let possible = 0;
  for (const signal of signals) {
    const observed = grading.concept_coverage.find((c) => c.signal_id === signal.id);
    earned += signal.weight * CREDIT[observed?.status ?? 'missing'];
    possible += signal.weight;
  }

  const weightedCoverage = possible > 0 ? earned / possible : 0;

  return round1(
    weightedCoverage *
      10 *
      OWNERSHIP_MULTIPLIER[grading.ownership] *
      SPECIFICITY_MULTIPLIER[grading.specificity],
  );
}

// ── §9.3 Behavioral ──────────────────────────────────────────────────────────

export function scoreBehavioral(grading: Grading): number {
  const s = grading.star;
  const star =
    (Number(s.has_situation) + Number(s.has_task) + Number(s.has_action) + Number(s.has_result)) / 4;
  return round1((0.7 * star + 0.3 * s.reflection_quality) * 10);
}

// ── §9.4 Fluency ─────────────────────────────────────────────────────────────

/**
 * Band scoring, never linear — both too slow and too fast are problems.
 * Returns null when the answer was too short or too poorly transcribed to judge;
 * a null here removes the answer from every fluency aggregate rather than
 * scoring it as zero.
 */
export function scoreFluency(metrics: SpeechMetrics, language: string): number | null {
  if (metrics.reliability === 'low') return null;

  // Articulation rate needs inter-word gaps; gross rate does not. Whichever the
  // transcriber gave us is the pace measurement.
  const wpm = metrics.wpm_articulation ?? metrics.wpm_gross;
  if (wpm === null) return null;

  /*
   * Weights are renormalised over the components actually present.
   *
   * Without per-word timing the pause profile is unknown. Scoring the missing
   * 0.20 as zero would quietly cap everyone at 8.0; scoring it as ten would
   * hand out marks for something never measured. Dropping it and rescaling the
   * rest is the only honest option, and it keeps the relative weighting of pace,
   * fillers and repetition exactly as §9.4 specifies.
   */
  const parts: Array<{ weight: number; score: number }> = [
    { weight: 0.35, score: scorePace(wpm, bandsFor(language)) },
    { weight: 0.3, score: scoreFillerRate(metrics.filler_rate) },
    { weight: 0.15, score: scoreRepetition(metrics.repetition_rate) },
  ];

  if (metrics.has_pause_data && metrics.long_pauses_per_min !== null) {
    parts.push({ weight: 0.2, score: scoreLongPauses(metrics.long_pauses_per_min) });
  }

  const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0);
  const weighted = parts.reduce((acc, p) => acc + p.weight * p.score, 0);

  return round1(weighted / totalWeight);
}

function scorePace(wpm: number, bands: WpmBands): number {
  if (wpm >= bands.ideal[0] && wpm <= bands.ideal[1]) return 10;
  if (wpm >= bands.good[0] && wpm <= bands.good[1]) return 8;
  if (wpm >= bands.fair[0] && wpm <= bands.fair[1]) return 6;
  return 4;
}

function scoreFillerRate(rate: number): number {
  if (rate < 0.02) return 10;
  if (rate < 0.04) return 8;
  if (rate < 0.07) return 6;
  if (rate < 0.11) return 4;
  return 2;
}

function scoreLongPauses(perMin: number): number {
  if (perMin === 0) return 10;
  if (perMin <= 1) return 8;
  if (perMin <= 2) return 6;
  return 4;
}

function scoreRepetition(rate: number): number {
  if (rate < 0.01) return 10;
  if (rate < 0.025) return 8;
  if (rate < 0.05) return 6;
  return 4;
}

// ── §9.5 Coding ──────────────────────────────────────────────────────────────

export interface CodingInputs {
  /** From a real sandbox run. NEVER from a model's opinion about whether it works. */
  testPassRate: number;
  complexityMatch: number;
  codeQuality: number;
  verbalReasoning: number;
}

export function scoreCoding(input: CodingInputs): number {
  return round1(
    (0.5 * input.testPassRate +
      0.2 * input.complexityMatch +
      0.15 * input.codeQuality +
      0.15 * input.verbalReasoning) *
      10,
  );
}

// ── Per-question dispatch ────────────────────────────────────────────────────

export interface QuestionScores {
  accuracy: number | null;
  depth: number | null;
  behavioral: number | null;
  fluency: number | null;
  /** The single number that feeds aggregation, whichever mode produced it. */
  primary: number;
  mode: GradingMode;
}

export function scoreQuestion(args: {
  mode: GradingMode;
  grading: Grading;
  signals: RubricSignal[];
  metrics?: SpeechMetrics;
  language: string;
  partiallyHeard?: boolean;
  coding?: CodingInputs;
}): QuestionScores {
  const fluency = args.metrics ? scoreFluency(args.metrics, args.language) : null;

  switch (args.mode) {
    case 'factual': {
      const accuracy = scoreAccuracy(args.grading, args.signals, {
        partiallyHeard: args.partiallyHeard,
      });
      return { accuracy, depth: null, behavioral: null, fluency, primary: accuracy, mode: args.mode };
    }
    case 'experiential': {
      const depth = scoreDepth(args.grading, args.signals);
      return { accuracy: null, depth, behavioral: null, fluency, primary: depth, mode: args.mode };
    }
    case 'behavioral': {
      const behavioral = scoreBehavioral(args.grading);
      return { accuracy: null, depth: null, behavioral, fluency, primary: behavioral, mode: args.mode };
    }
    case 'coding': {
      const coding = args.coding
        ? scoreCoding(args.coding)
        : scoreDepth(args.grading, args.signals);
      return { accuracy: null, depth: null, behavioral: null, fluency, primary: coding, mode: args.mode };
    }
  }
}

// ── §9.6 Goal and section aggregation ────────────────────────────────────────

export interface ScoredQuestion {
  seq: number;
  goalId?: string;
  sectionId: string;
  weight: number;
  scores: QuestionScores;
  /** Ungraded and low-reliability questions are excluded from all denominators. */
  excluded: boolean;
}

export interface SessionScores {
  overall: number;
  accuracy: number | null;
  depth: number | null;
  behavioral: number | null;
  coding: number | null;
  /** Reported separately from competence and kept OUT of `overall` (§9.4). */
  fluency: number | null;
  by_section: Array<{ section_id: string; score: number; incomplete: boolean }>;
  by_goal: Array<{ goal_id: string; score: number; status: string; incomplete: boolean }>;
  questions_scored: number;
  questions_excluded: number;
}

/**
 * Aggregation is goal-weighted, not question-weighted — a goal that took four
 * questions should not count four times.
 */
export function aggregateSession(
  questions: ScoredQuestion[],
  coverage: Coverage,
  blueprint: Blueprint,
  opts: { mode?: 'practice' | 'screening' } = {},
): SessionScores {
  const included = questions.filter((q) => !q.excluded);

  // goal_score = Σ(question_score × weight) / Σ(weight), within the goal
  const goalScores = new Map<string, number>();
  for (const goal of coverage.goals) {
    const qs = included.filter((q) => q.goalId === goal.goal_id);
    if (qs.length === 0) continue;

    const weightSum = qs.reduce((acc, q) => acc + q.weight, 0);
    const scoreSum = qs.reduce((acc, q) => acc + q.scores.primary * q.weight, 0);
    goalScores.set(goal.goal_id, weightSum > 0 ? scoreSum / weightSum : 0);
  }

  const byGoal = coverage.goals
    .filter((g) => goalScores.has(g.goal_id))
    .map((g) => ({
      goal_id: g.goal_id,
      score: round1(goalScores.get(g.goal_id)!),
      status: g.status,
      // Abandoned goals are scored on the evidence actually gathered and flagged
      // incomplete — never scored as zero.
      incomplete: g.status === 'abandoned' || g.status === 'in_progress',
    }));

  // section_score = Σ(goal_score × goal_priority) / Σ(goal_priority)
  const bySection = blueprint.sections
    .map((section) => {
      let weighted = 0;
      let priority = 0;
      let incomplete = false;

      for (const goal of section.goals) {
        const score = goalScores.get(goal.goal_id);
        if (score === undefined) {
          incomplete = true;
          continue;
        }
        weighted += score * goal.priority;
        priority += goal.priority;
        const state = coverage.goals.find((g) => g.goal_id === goal.goal_id);
        if (state && state.status !== 'satisfied') incomplete = true;
      }

      return {
        section_id: section.section_id,
        type: section.type,
        score: priority > 0 ? round1(weighted / priority) : null,
        incomplete,
      };
    })
    .filter((s): s is typeof s & { score: number } => s.score !== null);

  // Dimension rollups, by grading mode rather than by section label.
  const accuracy = meanOf(included.filter((q) => q.scores.accuracy !== null).map((q) => q.scores.accuracy!));
  const depth = meanOf(included.filter((q) => q.scores.depth !== null).map((q) => q.scores.depth!));
  const behavioral = meanOf(included.filter((q) => q.scores.behavioral !== null).map((q) => q.scores.behavioral!));
  const coding = meanOf(
    included.filter((q) => q.scores.mode === 'coding').map((q) => q.scores.primary),
  );
  const fluency = meanOf(included.filter((q) => q.scores.fluency !== null).map((q) => q.scores.fluency!));

  // accuracy_total is the weighted mean over factual + experiential.
  const accuracyTotal = meanOf(
    included
      .filter((q) => q.scores.mode === 'factual' || q.scores.mode === 'experiential')
      .map((q) => q.scores.primary),
  );

  const overall = computeOverall(
    { accuracy: accuracyTotal, coding, behavioral },
    opts.mode ?? 'practice',
  );

  return {
    overall,
    accuracy: accuracy !== null ? round1(accuracy) : null,
    depth: depth !== null ? round1(depth) : null,
    behavioral: behavioral !== null ? round1(behavioral) : null,
    coding: coding !== null ? round1(coding) : null,
    fluency: fluency !== null ? round1(fluency) : null,
    by_section: bySection.map((s) => ({
      section_id: s.section_id,
      score: s.score,
      incomplete: s.incomplete,
    })),
    by_goal: byGoal,
    questions_scored: included.length,
    questions_excluded: questions.length - included.length,
  };
}

/**
 * overall (practice)  = 0.55×accuracy + 0.30×coding + 0.15×behavioral
 * overall (screening) = 0.50×accuracy + 0.25×coding + 0.15×behavioral + 0.10×communication
 *
 * Fluency is deliberately absent from the practice formula. §9.4 constraint 2:
 * report it separately from competence and keep it out of the headline number.
 * Weights are renormalised over whichever dimensions actually ran, so a session
 * without a coding round is not silently penalised for the missing 30%.
 */
function computeOverall(
  dims: { accuracy: number | null; coding: number | null; behavioral: number | null },
  mode: 'practice' | 'screening',
): number {
  const weights =
    mode === 'practice'
      ? { accuracy: 0.55, coding: 0.3, behavioral: 0.15 }
      : { accuracy: 0.5, coding: 0.25, behavioral: 0.15 };

  let total = 0;
  let weightSum = 0;

  for (const [key, weight] of Object.entries(weights) as Array<
    [keyof typeof dims, number]
  >) {
    const value = dims[key];
    if (value === null) continue;
    total += value * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? round1(total / weightSum) : 0;
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface Readiness {
  overall: number;
  resume_match: number;
  technical: number;
  behavioral: number;
  coding: number;
  system_design: number;
  computed_at: string;
  /**
   * One entry per completed session, newest last.
   *
   * Per-dimension values are recorded, not just `overall`, because the rollup is
   * now a mean over these rather than a running blend — so the history has to
   * carry everything the mean is taken of.
   */
  history: Array<{
    session_id: string;
    overall: number;
    at: string;
    technical?: number | null;
    behavioral?: number | null;
    coding?: number | null;
  }>;
}

/**
 * Project-level readiness, 0-100 — the AVERAGE across every session on the
 * project, not a reading of the latest one.
 *
 * It used to be an exponentially-weighted blend (`0.4 × before + 0.6 × next`),
 * which made the number impossible to interpret: it was neither this interview's
 * result nor a fair average, and a single strong session could carry a weak
 * history for weeks. The per-session score lives on `sessions.scores` and is
 * what the report shows; this is the trend line, and a trend line should be the
 * mean of its points.
 *
 * db-design.md §3.3 caps `history` at 20 entries on write — it drives a
 * sparkline, not an archive — so the mean is over the last 20 sessions.
 */
export function computeReadiness(args: {
  scores: SessionScores;
  previous?: Readiness | null;
  resumeMatch?: number | null;
  sessionId: string;
}): Readiness {
  const toPct = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10));
  const prev = args.previous;

  // This session's own numbers, untouched by anything that came before.
  const sessionTechnical = toPct(args.scores.accuracy);
  const sessionBehavioral = toPct(args.scores.behavioral);
  const sessionCoding = toPct(args.scores.coding);

  const sessionParts = [sessionTechnical, sessionBehavioral, sessionCoding].filter(
    (p): p is number => p !== null,
  );
  const sessionOverall = sessionParts.length
    ? Math.round(sessionParts.reduce((a, b) => a + b, 0) / sessionParts.length)
    : 0;

  const history = [
    ...(prev?.history ?? []),
    {
      session_id: args.sessionId,
      overall: sessionOverall,
      at: new Date().toISOString(),
      technical: sessionTechnical,
      behavioral: sessionBehavioral,
      coding: sessionCoding,
    },
  ].slice(-20);

  /*
   * Each dimension is the mean of the sessions that actually measured it.
   *
   * Sessions without a coding module contribute nothing to the coding mean
   * rather than a zero — otherwise every conversation-only interview would drag
   * down a coding score it never attempted (§9.6's rule for abandoned goals,
   * applied at the project level).
   */
  const meanOverHistory = (pick: (h: Readiness['history'][number]) => number | null | undefined) => {
    const values = history
      .map(pick)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  };

  const technical = meanOverHistory((h) => h.technical);
  const behavioral = meanOverHistory((h) => h.behavioral);
  const coding = meanOverHistory((h) => h.coding);
  const systemDesign = prev?.system_design ?? 0;
  const resumeMatch = args.resumeMatch ?? prev?.resume_match ?? 0;

  // Entries written before per-dimension history existed carry only `overall`;
  // averaging that keeps older projects meaningful instead of resetting them.
  const dimensions = [technical, behavioral, coding, resumeMatch].filter((p) => p > 0);
  const overall = dimensions.length
    ? Math.round(dimensions.reduce((a, b) => a + b, 0) / dimensions.length)
    : meanOverHistory((h) => h.overall);

  return {
    overall,
    resume_match: resumeMatch,
    technical,
    behavioral,
    coding,
    system_design: systemDesign,
    computed_at: new Date().toISOString(),
    history,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function meanOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
