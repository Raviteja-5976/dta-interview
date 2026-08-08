/**
 * L3 · Evidence Coverage Tracker
 *
 * Deterministic. No model call, no network, budget <40ms (agentdesign.md §10).
 *
 * This is design decision D5: sections end because they are *done*, not because
 * a question counter tripped. L3 is what makes that possible — it answers "what
 * am I still missing?" cheaply enough to run before every single L1 call, which
 * is why L1's first input is always an accurate gap list.
 *
 * The fast path is lexical. agentdesign.md §12 flags false positives here as a
 * known risk and prescribes an async refinement pass that corrects marks before
 * the next turn; `refineEvidenceMark` is the seam for that, and evaluation reads
 * refined state only.
 */

import type { Blueprint } from '../agents/schemas';
import {
  DEPTH_ORDER,
  depthAtLeast,
  type Coverage,
  type DepthLevel,
  type EvidenceState,
  type GoalCoverage,
  type QuestionRecord,
} from './types';

const VERIFIED_AT = 0.7;
const PARTIAL_AT = 0.35;

// ── Seeding ──────────────────────────────────────────────────────────────────

/**
 * The tracker's schema *is* the blueprint's evidence contract (dependency rule
 * in §2.3), so seeding is a direct projection — never an interpretation.
 */
export function seedCoverage(sessionId: string, blueprint: Blueprint): Coverage {
  const goals: GoalCoverage[] = [];

  for (const section of blueprint.sections) {
    for (const goal of section.goals) {
      goals.push({
        goal_id: goal.goal_id,
        section_id: section.section_id,
        status: 'not_started',
        turns_spent: 0,
        confidence: 0,
        depth_reached: 'surface',
        evidence: goal.evidence_required.map((ev) => ({
          evidence_id: ev.evidence_id,
          status: 'missing',
          confidence: 0,
          source_question_ids: [],
        })),
        outstanding: goal.evidence_required.map((ev) => ev.evidence_id),
        turns_without_new_evidence: 0,
      });
    }
  }

  return {
    session_id: sessionId,
    updated_at_turn: 0,
    goals,
    by_skill: [],
    section_status: blueprint.sections.map((s) => ({
      section_id: s.section_id,
      goals_total: s.goals.length,
      goals_satisfied: 0,
      complete: false,
      time_used_sec: 0,
      time_budget_sec: s.time_budget_sec,
    })),
  };
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export interface IngestResult {
  coverage: Coverage;
  /** Evidence ids that moved to `verified` on this turn. Drives R8 rhythm. */
  newlyVerified: string[];
  /** True when the answer read as "I don't know" — R9's two-strike rule. */
  disclaimed: boolean;
  /** True when the answer produced little or no evidence. */
  weak: boolean;
}

export function ingestAnswer(
  coverage: Coverage,
  blueprint: Blueprint,
  question: QuestionRecord,
  answerText: string,
  turn: number,
): IngestResult {
  const next: Coverage = structuredClone(coverage);
  next.updated_at_turn = turn;

  const normalized = normalize(answerText);
  const disclaimed = isDisclaimer(normalized);
  const newlyVerified: string[] = [];

  const goal = question.goal_id
    ? next.goals.find((g) => g.goal_id === question.goal_id)
    : undefined;

  if (!goal) {
    return { coverage: next, newlyVerified, disclaimed, weak: disclaimed };
  }

  const bpGoal = findGoal(blueprint, goal.goal_id);
  goal.turns_spent += 1;
  if (goal.status === 'not_started') goal.status = 'in_progress';

  if (!disclaimed && bpGoal) {
    // Only evidence this question was actually aiming at. Crediting evidence a
    // question never targeted is how a lexical tracker fools itself.
    const targets = question.targets_evidence.length
      ? question.targets_evidence
      : goal.outstanding;

    for (const evidenceId of targets) {
      const state = goal.evidence.find((e) => e.evidence_id === evidenceId);
      if (!state || state.status === 'verified') continue;

      const acceptPhrases = collectAcceptPhrases(bpGoal, evidenceId);
      const description =
        bpGoal.evidence_required.find((e) => e.evidence_id === evidenceId)?.description ?? '';

      const match = scoreEvidence(normalized, answerText, acceptPhrases, description);
      if (match.confidence <= state.confidence) continue;

      state.confidence = match.confidence;
      state.span = match.span;
      if (!state.source_question_ids.includes(question.question_id)) {
        state.source_question_ids.push(question.question_id);
      }

      if (match.confidence >= VERIFIED_AT) {
        state.status = 'verified';
        state.verified_at_turn = turn;
        newlyVerified.push(evidenceId);
      } else if (match.confidence >= PARTIAL_AT) {
        state.status = 'partial';
        state.note = 'Touched on but not established.';
      }
    }
  }

  goal.outstanding = goal.evidence.filter((e) => e.status !== 'verified').map((e) => e.evidence_id);
  goal.confidence = averageConfidence(goal.evidence);
  goal.depth_reached = inferDepth(answerText, goal.depth_reached);
  goal.turns_without_new_evidence =
    newlyVerified.length > 0 ? 0 : goal.turns_without_new_evidence + 1;

  if (bpGoal && isGoalSatisfied(goal, bpGoal)) goal.status = 'satisfied';

  recomputeSections(next, blueprint);
  next.by_skill = recomputeSkills(next, blueprint);

  const weak = disclaimed || (newlyVerified.length === 0 && goal.confidence < PARTIAL_AT);
  return { coverage: next, newlyVerified, disclaimed, weak };
}

// ── Completion & exit checks ─────────────────────────────────────────────────

type BlueprintGoal = Blueprint['sections'][number]['goals'][number];

export function isGoalSatisfied(state: GoalCoverage, goal: BlueprintGoal): boolean {
  const { required_evidence, min_confidence, min_depth } = goal.completion_criteria;

  const allRequiredVerified = required_evidence.every(
    (id) => state.evidence.find((e) => e.evidence_id === id)?.status === 'verified',
  );

  return (
    allRequiredVerified &&
    state.confidence >= min_confidence &&
    depthAtLeast(state.depth_reached, min_depth)
  );
}

export interface ExitCheck {
  triggered: boolean;
  reason?: 'evidence_complete' | 'diminishing_returns' | 'candidate_disclaims' | 'time_ceiling' | 'distress';
}

/**
 * Typed exit conditions, evaluated in code — the reason D5 works. A goal that
 * cannot close is a goal that eats the interview, so every one of these is
 * mandatory in the blueprint schema.
 */
export function checkGoalExit(
  state: GoalCoverage,
  goal: BlueprintGoal,
  opts: { consecutiveWeak: number; dontKnowCount: number },
): ExitCheck {
  if (state.status === 'satisfied') return { triggered: true, reason: 'evidence_complete' };
  if (state.turns_spent >= goal.exit_conditions.max_turns) {
    return { triggered: true, reason: 'time_ceiling' };
  }
  if (state.turns_without_new_evidence >= goal.exit_conditions.no_new_evidence_for_turns) {
    return { triggered: true, reason: 'diminishing_returns' };
  }
  if (goal.exit_conditions.allow_candidate_disclaim && opts.dontKnowCount >= 2) {
    return { triggered: true, reason: 'candidate_disclaims' };
  }
  // R9: two consecutive weak answers means the topic is yielding nothing.
  // Continuing is both unkind and uninformative.
  if (opts.consecutiveWeak >= 2) return { triggered: true, reason: 'distress' };

  return { triggered: false };
}

export function isSectionComplete(coverage: Coverage, sectionId: string): boolean {
  const goals = coverage.goals.filter((g) => g.section_id === sectionId);
  return goals.length > 0 && goals.every((g) => g.status === 'satisfied' || g.status === 'abandoned');
}

// ── Refinement seam (async, off the critical path) ───────────────────────────

/**
 * Corrects a fast-path mark. agentdesign.md §12 requires that evaluation reads
 * refined state only; call this from the async pass with a better judgement than
 * lexical matching can produce.
 */
export function refineEvidenceMark(
  coverage: Coverage,
  goalId: string,
  evidenceId: string,
  verdict: { status: EvidenceState['status']; confidence: number; note?: string },
): Coverage {
  const next: Coverage = structuredClone(coverage);
  const state = next.goals
    .find((g) => g.goal_id === goalId)
    ?.evidence.find((e) => e.evidence_id === evidenceId);
  if (!state) return next;

  state.status = verdict.status;
  state.confidence = verdict.confidence;
  if (verdict.note) state.note = verdict.note;

  const goal = next.goals.find((g) => g.goal_id === goalId)!;
  goal.outstanding = goal.evidence.filter((e) => e.status !== 'verified').map((e) => e.evidence_id);
  goal.confidence = averageConfidence(goal.evidence);
  return next;
}

// ── Matching internals ───────────────────────────────────────────────────────

/** Words carrying no topical signal; excluded from overlap scoring. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'that', 'this', 'these', 'those',
  'is', 'was', 'were', 'are', 'be', 'been', 'being', 'am', 'it', 'its', 'as', 'at', 'by',
  'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with', 'we', 'i', 'you', 'they', 'he', 'she',
  'my', 'our', 'your', 'their', 'me', 'us', 'them', 'do', 'did', 'does', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'there', 'here', 'what', 'which', 'who', 'how',
  'when', 'where', 'why', 'not', 'no', 'yes', 'just', 'like', 'really', 'very', 'some', 'any',
  'about', 'up', 'out', 'over', 'more', 'also', 'kind', 'sort', 'thing', 'things', 'stuff',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s+#.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentTokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function collectAcceptPhrases(goal: BlueprintGoal, evidenceId: string): string[] {
  const phrases: string[] = [];
  for (const q of goal.question_bank) {
    for (const signal of q.rubric.expected_signals) {
      if (signal.evidence_id === evidenceId) phrases.push(...signal.accept_if_candidate_says);
    }
  }
  return phrases;
}

interface EvidenceMatch {
  confidence: number;
  span?: string;
}

/**
 * Two signals, combined. Phrase hits are the strong one — the blueprint author
 * wrote those as literal spoken phrasings for exactly this purpose. Token
 * overlap against the evidence description is the weak backstop for candidates
 * who said the right thing in unanticipated words.
 */
function scoreEvidence(
  normalizedAnswer: string,
  rawAnswer: string,
  acceptPhrases: string[],
  description: string,
): EvidenceMatch {
  let phraseScore = 0;
  let span: string | undefined;

  for (const phrase of acceptPhrases) {
    const needle = normalize(phrase);
    if (needle.length < 3) continue;
    if (normalizedAnswer.includes(needle)) {
      phraseScore = Math.max(phraseScore, 0.55);
      span ??= extractSpan(rawAnswer, phrase);
    }
  }
  // Two independent phrase hits is much stronger evidence than one.
  const hits = acceptPhrases.filter((p) => {
    const n = normalize(p);
    return n.length >= 3 && normalizedAnswer.includes(n);
  }).length;
  if (hits >= 2) phraseScore = 0.8;
  if (hits >= 3) phraseScore = 0.9;

  const descTokens = contentTokens(description);
  const answerTokens = contentTokens(normalizedAnswer);
  let overlap = 0;
  for (const t of descTokens) if (answerTokens.has(t)) overlap += 1;
  const overlapScore = descTokens.size > 0 ? (overlap / descTokens.size) * 0.6 : 0;

  const confidence = Math.min(1, Math.max(phraseScore, overlapScore));
  return { confidence, span: span ?? (confidence >= PARTIAL_AT ? firstSentence(rawAnswer) : undefined) };
}

function extractSpan(raw: string, phrase: string): string | undefined {
  const idx = raw.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx === -1) return firstSentence(raw);
  const start = Math.max(0, raw.lastIndexOf(' ', Math.max(0, idx - 40)));
  const end = Math.min(raw.length, idx + phrase.length + 60);
  return raw.slice(start, end).trim();
}

function firstSentence(raw: string): string {
  const match = raw.match(/^.{0,200}?[.!?](\s|$)/);
  return (match?.[0] ?? raw.slice(0, 200)).trim();
}

const DISCLAIMERS = [
  "i don't know", 'i do not know', 'no idea', 'not sure', "i haven't", 'i have not used',
  "i've never", 'i have never', 'never used', 'not familiar', "can't recall", 'cannot recall',
  'no experience', "haven't worked with", 'not really',
];

function isDisclaimer(normalized: string): boolean {
  if (normalized.split(' ').length > 40) return false; // a long answer is an attempt
  return DISCLAIMERS.some((d) => normalized.includes(d));
}

/**
 * Depth heuristics. These mirror the four levels in the blueprint's
 * `min_depth`: naming a thing is surface, describing how you used it is working,
 * describing how you built it is implementation, weighing it against
 * alternatives is design.
 */
function inferDepth(answer: string, current: DepthLevel): DepthLevel {
  const n = normalize(answer);
  let level: DepthLevel = 'surface';

  const hasOwnership = /\b(i wrote|i built|i set up|i implemented|i configured|i designed|i debugged)\b/.test(n);
  const hasSpecifics = /\b\d+(\.\d+)?\s*(ms|s|k|m|gb|mb|rps|qps|%|percent|users|nodes|pods|replicas)\b/.test(n) ||
    /\b(because|so that|which meant|the reason)\b/.test(n);
  const hasTradeoff = /\b(trade-?off|instead of|rather than|we chose|we considered|the downside|alternative|versus|vs\b)/.test(n);

  if (n.split(' ').length > 12) level = 'working';
  if (hasOwnership && hasSpecifics) level = 'implementation';
  if (hasTradeoff && hasOwnership) level = 'design';

  // Depth is a high-water mark: a short follow-up answer does not undo the
  // depth a candidate already demonstrated on this goal.
  return DEPTH_ORDER.indexOf(level) > DEPTH_ORDER.indexOf(current) ? level : current;
}

function averageConfidence(evidence: EvidenceState[]): number {
  if (evidence.length === 0) return 0;
  const sum = evidence.reduce((acc, e) => acc + e.confidence, 0);
  return Math.round((sum / evidence.length) * 100) / 100;
}

function findGoal(blueprint: Blueprint, goalId: string): BlueprintGoal | undefined {
  for (const section of blueprint.sections) {
    const goal = section.goals.find((g) => g.goal_id === goalId);
    if (goal) return goal;
  }
  return undefined;
}

function recomputeSections(coverage: Coverage, blueprint: Blueprint): void {
  for (const section of coverage.section_status) {
    const goals = coverage.goals.filter((g) => g.section_id === section.section_id);
    section.goals_satisfied = goals.filter((g) => g.status === 'satisfied').length;
    section.complete = goals.length > 0 && goals.every(
      (g) => g.status === 'satisfied' || g.status === 'abandoned',
    );
  }
  void blueprint;
}

function recomputeSkills(coverage: Coverage, blueprint: Blueprint) {
  const bySkill = new Map<string, { verified: number; total: number; conf: number[]; depth: DepthLevel }>();

  for (const section of blueprint.sections) {
    for (const goal of section.goals) {
      const state = coverage.goals.find((g) => g.goal_id === goal.goal_id);
      if (!state) continue;

      for (const skill of goal.skill_tags) {
        const entry = bySkill.get(skill) ?? { verified: 0, total: 0, conf: [], depth: 'surface' as DepthLevel };
        entry.verified += state.evidence.filter((e) => e.status === 'verified').length;
        entry.total += state.evidence.length;
        entry.conf.push(state.confidence);
        if (DEPTH_ORDER.indexOf(state.depth_reached) > DEPTH_ORDER.indexOf(entry.depth)) {
          entry.depth = state.depth_reached;
        }
        bySkill.set(skill, entry);
      }
    }
  }

  return [...bySkill.entries()].map(([skill, e]) => ({
    skill,
    verified_concepts: e.verified,
    total_concepts: e.total,
    confidence: e.conf.length ? Math.round((e.conf.reduce((a, b) => a + b, 0) / e.conf.length) * 100) / 100 : 0,
    depth: e.depth,
    still_needed: Math.max(0, e.total - e.verified),
  }));
}
