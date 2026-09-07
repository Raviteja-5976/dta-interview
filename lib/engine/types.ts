/**
 * Runtime types for the live loop.
 *
 * These correspond to agentdesign.md §3.1 (`runtime`), §3.3 (`evidence_coverage`)
 * and §3.4 (`question_record`). They are deliberately plain data: the rule layer
 * in rules.ts must be evaluable in pure code with no lookups and no model call.
 */

import type { ConversationalIntent, UtterancePlan } from '../agents/schemas';

export type DepthLevel = 'surface' | 'working' | 'implementation' | 'design';
/**
 * Mirrors `gradingMode` in ../agents/schemas.ts. `skill` is the skill-challenge
 * round — something built or fixed in the editor and judged against
 * requirements written at plan time, as distinct from `coding`, which has a
 * sandbox and a measured pass rate behind it.
 */
export type GradingMode = 'factual' | 'experiential' | 'behavioral' | 'coding' | 'skill';
export type EntryStyle = 'direct' | 'story' | 'hypothetical' | 'comparative';

export const DEPTH_ORDER: DepthLevel[] = ['surface', 'working', 'implementation', 'design'];

export function depthAtLeast(actual: DepthLevel, required: DepthLevel): boolean {
  return DEPTH_ORDER.indexOf(actual) >= DEPTH_ORDER.indexOf(required);
}

// ── Evidence coverage (L3) ───────────────────────────────────────────────────

export interface EvidenceState {
  evidence_id: string;
  status: 'verified' | 'partial' | 'missing';
  confidence: number;
  source_question_ids: string[];
  span?: string;
  note?: string;
  verified_at_turn?: number;
}

export interface GoalCoverage {
  goal_id: string;
  section_id: string;
  status: 'not_started' | 'in_progress' | 'satisfied' | 'abandoned';
  turns_spent: number;
  confidence: number;
  depth_reached: DepthLevel;
  evidence: EvidenceState[];
  outstanding: string[];
  /** Drives the `diminishing_returns` exit condition. */
  turns_without_new_evidence: number;
}

export interface SkillCoverage {
  skill: string;
  verified_concepts: number;
  total_concepts: number;
  confidence: number;
  depth: DepthLevel;
  still_needed: number;
}

export interface SectionCoverage {
  section_id: string;
  goals_total: number;
  goals_satisfied: number;
  complete: boolean;
  time_used_sec: number;
  time_budget_sec: number;
}

export interface Coverage {
  session_id: string;
  updated_at_turn: number;
  goals: GoalCoverage[];
  by_skill: SkillCoverage[];
  section_status: SectionCoverage[];
}

// ── Session runtime (§3.1) ───────────────────────────────────────────────────

/**
 * Everything the §4 rule layer needs, and nothing else. Kept flat and small on
 * purpose: it is checkpointed into `sessions.live_state` every few turns, and
 * agentdesign.md §10 names context creep in L1 as the thing that kills live
 * agents by turn twenty.
 */
export interface SessionRuntime {
  current_section_id: string;
  active_goal_id: string | null;
  elapsed_sec: number;
  turn: number;
  asked_bank_ids: string[];
  asked_followup_ids: string[];
  turns_on_active_goal: number;
  consecutive_weak_answers: number;
  corrections_used: number;
  current_difficulty: number;
  recent_acknowledgements: string[];
  recent_skill_tags: string[];
  recent_entry_styles: EntryStyle[];
  /** Turn number of the last CALLBACK, for R3's one-per-three-turns ceiling. */
  last_callback_turn: number | null;
  turns_since_difficulty_drop: number;
  /** Per-goal count of "I don't know"-shaped answers, for R9's two-strike rule. */
  dont_know_by_goal: Record<string, number>;
  sections_completed: string[];
  /**
   * Questions asked since entering the current section — R12's counter.
   *
   * Goal satisfaction alone was never enough to end a section: a goal only
   * closes when its evidence is verified or it runs out of turns, and L1 is free
   * to rotate between the goals of a section indefinitely, resetting nothing.
   * A section with three goals could therefore ask twelve questions and still
   * not be "complete". This is the ceiling that makes sections finite.
   */
  questions_in_section: number;
  /** Interview elapsed seconds when the current section was entered. */
  section_started_sec: number;
  /** Grading modes of recent questions, so the mix stays varied (R13). */
  recent_grading_modes: GradingMode[];
  finished: boolean;
}

/**
 * R12 · How many questions a section gets, by interview difficulty.
 *
 * The floor matters as much as the ceiling. Without it a section whose goals
 * happen to verify on the first answer would be left after one question, which
 * is how the interview used to feel — it never settled anywhere. The ceiling is
 * what stops the opposite failure.
 */
export const SECTION_QUESTION_BUDGET: Record<'easy' | 'medium' | 'hard', { min: number; max: number }> = {
  easy: { min: 2, max: 4 },
  medium: { min: 4, max: 6 },
  hard: { min: 5, max: 8 },
};

/**
 * Sections exempt from the FLOOR (never from the ceiling).
 *
 * The warm-up exists to let someone settle in and should close as soon as they
 * are talking; holding it open for four questions turns a courtesy into an
 * interrogation about themselves. The close is a goodbye.
 */
export const NO_FLOOR_SECTIONS = new Set(['intro', 'closing']);

export function initialRuntime(firstSectionId: string, startDifficulty: number): SessionRuntime {
  return {
    current_section_id: firstSectionId,
    active_goal_id: null,
    elapsed_sec: 0,
    turn: 0,
    asked_bank_ids: [],
    asked_followup_ids: [],
    turns_on_active_goal: 0,
    consecutive_weak_answers: 0,
    corrections_used: 0,
    current_difficulty: startDifficulty,
    recent_acknowledgements: [],
    recent_skill_tags: [],
    recent_entry_styles: [],
    last_callback_turn: null,
    turns_since_difficulty_drop: 99,
    dont_know_by_goal: {},
    sections_completed: [],
    questions_in_section: 0,
    section_started_sec: 0,
    recent_grading_modes: [],
    finished: false,
  };
}

/**
 * Backfills fields added after a session's `live_state` was first written.
 *
 * A live interview checkpoints its runtime every turn, so a deploy lands
 * mid-session for anyone currently talking. Reading a missing counter as
 * `undefined` would make every comparison against it false and silently disable
 * the rule it belongs to.
 */
export function withRuntimeDefaults(runtime: SessionRuntime): SessionRuntime {
  return {
    ...runtime,
    questions_in_section: runtime.questions_in_section ?? 0,
    section_started_sec: runtime.section_started_sec ?? 0,
    recent_grading_modes: runtime.recent_grading_modes ?? [],
  };
}

// ── Candidate actions (what the rule layer filters and L1 chooses among) ─────

export interface CandidateAction {
  action: ConversationalIntent['action'];
  goal_id?: string;
  section_id?: string;
  skill_tags: string[];
  /** Where the question text comes from. */
  source_kind: 'bank' | 'followup_bank' | 'callback' | 'generated' | 'none';
  source_id?: string;
  text?: string;
  targets_evidence: string[];
  difficulty?: number;
  entry_style?: EntryStyle;
  grading_mode?: GradingMode;
  /** Set by boost_callbacks (R3); higher sorts first in the shortlist. */
  priority: number;
}

// ── Question record (§3.4) ───────────────────────────────────────────────────

export interface WordTiming {
  w: string;
  s: number;
  e: number;
  conf?: number;
}

export interface AnswerRecord {
  transcript: string;
  start_ms: number;
  end_ms: number;
  word_count: number;
  words?: WordTiming[];
  words_url?: string;
  asr_confidence_avg?: number;
  interrupted?: boolean;
  silence_before_answer_ms?: number;
}

export interface QuestionRecord {
  question_id: string;
  seq: number;
  turn: number;
  section_id: string;
  goal_id?: string;
  /**
   * The goal as it was SHOWN to the candidate beside this question.
   *
   * Deliberately separate from `goal_id`, which drives coverage, the two-strike
   * counter and goal closure — rewriting that to fill a display gap would change
   * how the interview runs. This is a record of what the candidate was told the
   * question was for, captured at the moment it was asked, and it is what the
   * report's goal outcomes are written against. On a handoff `goal_id` is often
   * absent while this is not, because the section being entered supplies it.
   */
  displayed_goal?: {
    goal_id: string;
    statement: string;
    pursuing: string[];
  };
  bank_id?: string;
  /**
   * Where the question came from.
   *
   * `generated` means it was written during the interview against what the
   * candidate said, rather than taken from P6's plan-time bank. It is the flag
   * that decides whether this session's question scores can be compared to
   * another session's — see S1's `reproducibility` block. A deferred probe used
   * to be recorded as `bank`, which made a generated question look planned.
   */
  origin: 'bank' | 'followup' | 'callback' | 'closing' | 'correction' | 'intro' | 'generated';
  text: string;
  as_spoken: string;
  targets_evidence: string[];
  skill_tags: string[];
  difficulty: number;
  grading_mode: GradingMode;
  weight: number;
  rubric?: unknown;
  intent_snapshot?: ConversationalIntent;
  utterance_plan?: UtterancePlan;
  asked_at: string;
  answer?: AnswerRecord;
  /**
   * Set when the candidate barged in over the question. §9.1 suspends the
   * off-topic guard for these — you cannot penalise someone for a question they
   * did not hear in full.
   */
  partially_heard?: boolean;
  status: 'asked' | 'answered' | 'skipped' | 'graded' | 'ungraded';
}
