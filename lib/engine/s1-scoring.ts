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
import type { Coverage, GradingMode, QuestionRecord } from './types';
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

// ── Skill challenge ──────────────────────────────────────────────────────────

/**
 * One requirement, as SV found it in the submission.
 *
 * `met` is the model's observation; the weight came from P7 and was written
 * before the interview. Nothing here is a score — `skillRequirementCoverage`
 * below is what turns the pair into one.
 */
export interface SkillRequirementOutcome {
  met: 'yes' | 'partial' | 'no';
  /** P7's weight for this requirement, 1-3. */
  weight: number;
}

/** Partial credit is half. A requirement half-met is genuinely half the work. */
const MET_CREDIT: Record<SkillRequirementOutcome['met'], number> = {
  yes: 1,
  partial: 0.5,
  no: 0,
};

/**
 * The fraction of the challenge's requirements the submission met, weighted.
 *
 * This is the skill round's answer to `testPassRate` and it plays the same
 * structural role: the largest single term, and the one computed rather than
 * asked for. SV reports met / partial / no per requirement; the arithmetic
 * happens here, so the weights can be retuned without re-running a model and
 * two candidates who met the same requirements get the same number.
 *
 * Returns null when there is nothing to divide by — a validation that came back
 * with no requirement verdicts at all. Null propagates to "not scored" rather
 * than to zero, because a validator that returned nothing says nothing about
 * the candidate (§9.6).
 */
export function skillRequirementCoverage(outcomes: SkillRequirementOutcome[]): number | null {
  const total = outcomes.reduce((sum, o) => sum + Math.max(1, o.weight), 0);
  if (total === 0) return null;

  const earned = outcomes.reduce((sum, o) => sum + MET_CREDIT[o.met] * Math.max(1, o.weight), 0);
  return earned / total;
}

export interface SkillInputs {
  /** 0-1, from `skillRequirementCoverage`. The measured-ish half. */
  requirementCoverage: number;
  /** 0-10 from SV: would this actually do the job. */
  correctness: number;
  /** 0-10 from SV: idiom and structure for this technology. */
  codeQuality: number;
  /** 0-10 from E4, read off the transcript: did they explain it as they worked. */
  verbalReasoning: number;
}

/**
 * The skill round's score.
 *
 * Weighted like `scoreCoding` and for the same reasons, with one deliberate
 * difference: requirement coverage carries 45% rather than the coding round's
 * 50% on test pass rate. A sandbox verdict is a fact; a reading of whether a
 * requirement is met is a judgement, however good the reader — so it gets a
 * slightly smaller share, and `correctness` picks up the difference by asking
 * the same question a second way.
 *
 * Verbal reasoning keeps its 15%. The round is still an interview: someone who
 * writes a perfect component in silence has not shown they can work with anyone.
 */
export function scoreSkill(input: SkillInputs): number {
  return round1(
    (0.45 * input.requirementCoverage +
      0.25 * (input.correctness / 10) +
      0.15 * (input.codeQuality / 10) +
      0.15 * (input.verbalReasoning / 10)) *
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
  skill?: SkillInputs;
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
    case 'skill': {
      /*
       * Falls back to `scoreDepth` on the same terms the coding branch does: a
       * skill question that was talked about rather than submitted — the turns
       * AFTER the editor closes, where the interviewer asks why they did it
       * that way — has a transcript and a rubric but no artifact, and grading
       * that as an experiential answer is exactly right.
       */
      const skill = args.skill ? scoreSkill(args.skill) : scoreDepth(args.grading, args.signals);
      return { accuracy: null, depth: null, behavioral: null, fluency, primary: skill, mode: args.mode };
    }
  }
}

/**
 * Whether a question can produce a real number at all.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `scoreAccuracy` and `scoreDepth` both open with `if (signals.length === 0)
 * return 0`, and a zero is indistinguishable from a genuinely bad answer once
 * it reaches an average. So a question with no rubric does not score badly — it
 * scores FALSELY, and then counts in the denominator while doing it.
 *
 * That was live: `resolveQuestionText` returns no rubric for a generated probe,
 * a memory callback, or a follow-up-bank entry, and grades all three as
 * experiential. Every `/reflect` probe and every callback in every interview
 * was therefore scored 0 out of 10 and averaged in — the more attentive the
 * interviewer was, the worse the candidate's report looked.
 *
 * §9.6's rule is that ungraded questions are excluded from all denominators,
 * never scored as zero. This is that rule, stated once, where the formulas live.
 *
 * Note the two modes that do NOT need signals. Behavioral is scored on STAR
 * structure read out of the answer itself, and coding on a measured pass rate
 * from the sandbox — neither consults the rubric, so neither is ungradeable for
 * want of one.
 */
export function isGradeable(args: {
  mode: GradingMode;
  signals: RubricSignal[];
  /** True when the sandbox actually returned a pass rate for this question. */
  hasCodingResult?: boolean;
  /** True when SV actually returned requirement verdicts for this question. */
  hasSkillResult?: boolean;
}): boolean {
  switch (args.mode) {
    case 'factual':
    case 'experiential':
      return args.signals.length > 0;
    case 'behavioral':
      return true;
    case 'coding':
      return Boolean(args.hasCodingResult) || args.signals.length > 0;
    /*
     * A skill submission that SV could not review is NOT scored, and is not
     * scored as zero either — a validator that timed out says nothing about the
     * candidate. The same rule the coding round has when Judge0 is unavailable.
     */
    case 'skill':
      return Boolean(args.hasSkillResult) || args.signals.length > 0;
  }
}

// ── Evidence coverage · the reproducible unit ────────────────────────────────

export interface EvidenceCoverageScore {
  /** 0–10, weighted by evidence tier. Comparable across sessions. */
  score: number;
  required: number;
  verified: number;
  partial: number;
  missing: number;
}

export interface EvidenceRollup extends EvidenceCoverageScore {
  by_goal: Array<EvidenceCoverageScore & { goal_id: string; status: string }>;
  by_skill: Array<EvidenceCoverageScore & { skill: string }>;
}

/**
 * Scores what the interview ESTABLISHED, from L3's coverage ledger.
 *
 * ── Why this is the number screening mode compares on ────────────────────────
 * A question score answers "how well did they answer THAT question", and when
 * the interviewer generates its own questions, two sessions never ask the same
 * ones — so question scores are not comparable run to run, and averaging them
 * across sessions compares different measurements.
 *
 * Evidence is comparable, because the evidence items come from the blueprint
 * and the blueprint is generated once per project from fixed inputs. "Did they
 * establish that they authored the manifests" has the same meaning in every
 * session, whichever question got them there. That is the whole point of D5 and
 * of the coverage tracker: a goal is a destination, and destinations are
 * stable even when routes are not.
 *
 * Deterministic — the ledger is already written, this only weights it.
 */
export function scoreEvidenceCoverage(
  coverage: Coverage,
  blueprint: Blueprint,
): EvidenceRollup {
  const tierWeight = { must_have: 3, good_to_have: 2, bonus: 1 } as const;
  const credit = { verified: 1.0, partial: 0.5, missing: 0.0 } as const;

  const byGoal: EvidenceRollup['by_goal'] = [];
  const bySkill = new Map<string, { earned: number; possible: number; counts: number[] }>();

  let totalEarned = 0;
  let totalPossible = 0;
  const totals = { required: 0, verified: 0, partial: 0, missing: 0 };

  for (const section of blueprint.sections) {
    for (const goal of section.goals) {
      const state = coverage.goals.find((g) => g.goal_id === goal.goal_id);
      if (!state) continue;

      let earned = 0;
      let possible = 0;
      const counts = { required: 0, verified: 0, partial: 0, missing: 0 };

      for (const required of goal.evidence_required) {
        const observed = state.evidence.find((e) => e.evidence_id === required.evidence_id);
        const status = observed?.status ?? 'missing';
        // The blueprint's own weight when it set one, else the tier default.
        const weight = required.weight || tierWeight[required.tier];

        earned += weight * (credit[status as keyof typeof credit] ?? 0);
        possible += weight;

        counts.required += 1;
        if (status === 'verified') counts.verified += 1;
        else if (status === 'partial') counts.partial += 1;
        else counts.missing += 1;
      }

      if (possible === 0) continue;

      /*
       * A goal nobody reached is NOT scored zero — it is left out entirely.
       *
       * §9.6's rule for abandoned goals, applied here: an interview that ran
       * out of time before a section is a shorter measurement, not a worse
       * candidate. Scoring the unreached as zero would make ending early look
       * like failing.
       */
      if (state.status === 'not_started') continue;

      byGoal.push({
        goal_id: goal.goal_id,
        status: state.status,
        score: round1((earned / possible) * 10),
        ...counts,
      });

      totalEarned += earned;
      totalPossible += possible;
      totals.required += counts.required;
      totals.verified += counts.verified;
      totals.partial += counts.partial;
      totals.missing += counts.missing;

      for (const skill of goal.skill_tags) {
        const entry = bySkill.get(skill) ?? { earned: 0, possible: 0, counts: [0, 0, 0, 0] };
        entry.earned += earned;
        entry.possible += possible;
        entry.counts[0] += counts.required;
        entry.counts[1] += counts.verified;
        entry.counts[2] += counts.partial;
        entry.counts[3] += counts.missing;
        bySkill.set(skill, entry);
      }
    }
  }

  return {
    score: totalPossible > 0 ? round1((totalEarned / totalPossible) * 10) : 0,
    ...totals,
    by_goal: byGoal,
    by_skill: [...bySkill.entries()].map(([skill, e]) => ({
      skill,
      score: e.possible > 0 ? round1((e.earned / e.possible) * 10) : 0,
      required: e.counts[0],
      verified: e.counts[1],
      partial: e.counts[2],
      missing: e.counts[3],
    })),
  };
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
  /**
   * The skill-challenge round: a React component, a SQL query, a fixed bug.
   *
   * Kept apart from `coding` rather than averaged into it, because the two are
   * measured by different instruments — a sandbox pass rate against a model
   * reading requirements — and a candidate reading a report deserves to know
   * which of the two a number came from.
   */
  skill: number | null;
  /** Reported separately from competence and kept OUT of `overall` (§9.4). */
  fluency: number | null;
  by_section: Array<{ section_id: string; score: number; incomplete: boolean }>;
  by_goal: Array<{ goal_id: string; score: number; status: string; incomplete: boolean }>;
  questions_scored: number;
  questions_excluded: number;

  /**
   * What the interview established, weighted by evidence tier.
   *
   * The cross-session unit. Question scores measure how an answer went;
   * this measures what is now known about the candidate, which is the thing
   * that means the same in every session.
   */
  evidence: EvidenceRollup;

  /**
   * How comparable this session's numbers are to another session's.
   *
   * Surfaced rather than assumed, because it changes with how the interview was
   * run: an interviewer that writes its own questions produces question scores
   * that are honest about THIS conversation and not directly comparable to the
   * next one, while `evidence.score` stays comparable either way.
   */
  reproducibility: {
    mode: 'practice' | 'screening';
    /** Where the questions came from. */
    question_source: 'planned' | 'generated' | 'mixed';
    /** The field to compare across sessions. Always evidence-based. */
    comparable_on: 'evidence.score';
    /**
     * False when the questions varied, i.e. `overall` reflects a conversation
     * that will not repeat. It does not mean the score is wrong — it means
     * ranking two candidates on it compares two different interviews.
     */
    question_scores_comparable: boolean;
  };
}

/**
 * Aggregation is goal-weighted, not question-weighted — a goal that took four
 * questions should not count four times.
 */
export function aggregateSession(
  questions: ScoredQuestion[],
  coverage: Coverage,
  blueprint: Blueprint,
  opts: {
    mode?: 'practice' | 'screening';
    /** Where each question came from, for the reproducibility verdict. */
    origins?: QuestionRecord['origin'][];
  } = {},
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
  const skill = meanOf(
    included.filter((q) => q.scores.mode === 'skill').map((q) => q.scores.primary),
  );
  const fluency = meanOf(included.filter((q) => q.scores.fluency !== null).map((q) => q.scores.fluency!));

  // accuracy_total is the weighted mean over factual + experiential.
  const accuracyTotal = meanOf(
    included
      .filter((q) => q.scores.mode === 'factual' || q.scores.mode === 'experiential')
      .map((q) => q.scores.primary),
  );

  const overall = computeOverall(
    { accuracy: accuracyTotal, coding, skill, behavioral },
    opts.mode ?? 'practice',
  );

  return {
    overall,
    accuracy: accuracy !== null ? round1(accuracy) : null,
    depth: depth !== null ? round1(depth) : null,
    behavioral: behavioral !== null ? round1(behavioral) : null,
    coding: coding !== null ? round1(coding) : null,
    skill: skill !== null ? round1(skill) : null,
    fluency: fluency !== null ? round1(fluency) : null,
    by_section: bySection.map((s) => ({
      section_id: s.section_id,
      score: s.score,
      incomplete: s.incomplete,
    })),
    by_goal: byGoal,
    questions_scored: included.length,
    questions_excluded: questions.length - included.length,
    evidence: scoreEvidenceCoverage(coverage, blueprint),
    reproducibility: describeReproducibility(opts.mode ?? 'practice', opts.origins ?? []),
  };
}

/**
 * States plainly which numbers survive being compared to another session.
 *
 * `generated` and `callback` questions are written during the interview against
 * what the candidate actually said, so they differ between two runs of the same
 * blueprint. A `bank` question does not — P6 wrote it once, before either run.
 */
function describeReproducibility(
  mode: 'practice' | 'screening',
  origins: QuestionRecord['origin'][],
): SessionScores['reproducibility'] {
  const varying = origins.filter((o) => o === 'generated' || o === 'callback').length;
  const planned = origins.filter((o) => o === 'bank' || o === 'followup').length;

  const source: SessionScores['reproducibility']['question_source'] =
    varying === 0 ? 'planned' : planned === 0 ? 'generated' : 'mixed';

  return {
    mode,
    question_source: source,
    comparable_on: 'evidence.score',
    question_scores_comparable: source === 'planned',
  };
}

/**
 * overall (practice)  = 0.55×accuracy + 0.30×coding + 0.20×skill + 0.15×behavioral
 * overall (screening) = 0.50×accuracy + 0.25×coding + 0.20×skill + 0.15×behavioral
 *
 * Fluency is deliberately absent from the practice formula. §9.4 constraint 2:
 * report it separately from competence and keep it out of the headline number.
 * Weights are renormalised over whichever dimensions actually ran, so a session
 * without a coding round is not silently penalised for the missing 30%.
 *
 * ── Why `skill` was added without touching the other three ───────────────────
 * Only the RATIOS between present dimensions matter, because of that
 * renormalisation. Adding a fourth weight rather than carving the new one out
 * of the existing three means a session with no skill round scores exactly what
 * it scored before this dimension existed — which is the difference between
 * shipping a feature and silently re-marking every past report.
 *
 * It sits between coding and behavioral on purpose: the skill round is a
 * hands-on test of what the job actually needs, so it outweighs the STAR
 * questions, and it is judged rather than executed, so it does not outweigh the
 * round with a sandbox behind it.
 */
function computeOverall(
  dims: {
    accuracy: number | null;
    coding: number | null;
    skill: number | null;
    behavioral: number | null;
  },
  mode: 'practice' | 'screening',
): number {
  const weights =
    mode === 'practice'
      ? { accuracy: 0.55, coding: 0.3, skill: 0.2, behavioral: 0.15 }
      : { accuracy: 0.5, coding: 0.25, skill: 0.2, behavioral: 0.15 };

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
  /**
   * The skill-challenge dimension.
   *
   * Replaces `system_design`, which was carried on this type for months and
   * never once written to — every session copied the previous value forward
   * from a field nothing set, so it read 0 for every project that ever existed.
   * This one is computed from the history like the others.
   */
  skill_challenge: number;
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
    skill?: number | null;
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
  const sessionSkill = toPct(args.scores.skill);

  const sessionParts = [sessionTechnical, sessionBehavioral, sessionCoding, sessionSkill].filter(
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
      skill: sessionSkill,
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
  const skillChallenge = meanOverHistory((h) => h.skill);
  const resumeMatch = args.resumeMatch ?? prev?.resume_match ?? 0;

  // Entries written before per-dimension history existed carry only `overall`;
  // averaging that keeps older projects meaningful instead of resetting them.
  const dimensions = [technical, behavioral, coding, skillChallenge, resumeMatch].filter((p) => p > 0);
  const overall = dimensions.length
    ? Math.round(dimensions.reduce((a, b) => a + b, 0) / dimensions.length)
    : meanOverHistory((h) => h.overall);

  return {
    overall,
    resume_match: resumeMatch,
    technical,
    behavioral,
    coding,
    skill_challenge: skillChallenge,
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
