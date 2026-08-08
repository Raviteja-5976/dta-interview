/**
 * Runtime types for the live loop.
 *
 * These correspond to agentdesign.md §3.1 (`runtime`), §3.3 (`evidence_coverage`)
 * and §3.4 (`question_record`). They are deliberately plain data: the rule layer
 * in rules.ts must be evaluable in pure code with no lookups and no model call.
 */

import type { ConversationalIntent, UtterancePlan } from '../agents/schemas';

export type DepthLevel = 'surface' | 'working' | 'implementation' | 'design';
export type GradingMode = 'factual' | 'experiential' | 'behavioral' | 'coding';
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
  finished: boolean;
}

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
    finished: false,
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
  bank_id?: string;
  origin: 'bank' | 'followup' | 'callback' | 'closing' | 'correction' | 'intro';
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
