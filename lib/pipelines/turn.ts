/**
 * O1 · The live turn cycle — agentdesign.md §2.2.
 *
 * Executed once per candidate answer:
 *
 *   answer → L3 (evidence, <40ms) → §4 pre-filter → L1 (≤350ms) → §4 post-validate
 *          → L4 (≤200ms) → L5 playback           ⟂ L2 async, off-path
 *
 * The orchestrator makes NO interview decisions (invariant 1). Everything below
 * is sequencing, budget enforcement, and persistence. Where it looks like it is
 * deciding — picking the next section, ending the interview — it is applying a
 * ceiling the blueprint or the strategy already set.
 *
 * Exactly two blocking model calls per turn: L1 and L4 (invariant 10).
 */

import type { Blueprint, ConversationalIntent, UtterancePlan } from '../agents/schemas';
import { runConversationManager } from '../agents/l1-conversation';
import { runDialogueStyler } from '../agents/l4-styler';
import { runMemoryExtraction } from '../agents/l2-memory';
import {
  callbackNouns,
  markCallbackSpent,
  mergeExtraction,
  openCallbacks,
  type InterviewMemory,
} from '../engine/l2-memory-store';
import {
  checkGoalExit,
  ingestAnswer,
  isSectionComplete,
} from '../engine/l3-evidence';
import {
  legalActions,
  pickAcknowledgement,
  validateAndRepairPlan,
  validateIntent,
  type RuleInput,
} from '../engine/rules';
import type {
  CandidateAction,
  Coverage,
  QuestionRecord,
  SessionRuntime,
} from '../engine/types';

export interface LiveState {
  v: 2;
  runtime: SessionRuntime;
  coverage: Coverage;
  memory: InterviewMemory;
  questions: QuestionRecord[];
  strategy?: { difficulty_curve: { start_level: number; max_level: number } };
}

export interface TurnInput {
  sessionId: string;
  userId: string;
  projectId: string;
  blueprint: Blueprint;
  state: LiveState;
  persona: string;
  /** The answer to the question asked last turn. Absent on the opening turn. */
  answer?: {
    transcript: string;
    durationSec: number;
    wordCount: number;
    startMs: number;
    endMs: number;
    asrConfidence?: number;
    /** Candidate barged in over the question — §9.1 suspends the off-topic guard. */
    partiallyHeard?: boolean;
  };
  /** Total elapsed interview seconds, for the hard ceiling. */
  elapsedSec: number;
  maxDurationSec: number;
}

export interface TurnOutput {
  state: LiveState;
  /** Null when the interview just ended. */
  utterance: {
    questionId: string;
    plan: UtterancePlan;
    /** Cache key: a clip is played only when its text matches exactly. */
    cacheText: string;
    bankId?: string;
  } | null;
  finished: boolean;
  intent: ConversationalIntent | null;
  diagnostics: {
    l1LatencyMs: number;
    l4LatencyMs: number;
    l1Fallback: boolean;
    l4Fallback: boolean;
    ruleRepairs: string[];
    intentRejected?: string;
    newlyVerified: string[];
  };
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const state: LiveState = structuredClone(input.state);
  const { blueprint } = input;
  const context = {
    userId: input.userId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  };

  let newlyVerified: string[] = [];
  let answerWeak = false;
  let disclaimed = false;

  // ── 1 · Ingest the answer · L3 · deterministic, <40ms ────────────────────
  const lastQuestion = state.questions.at(-1);

  if (input.answer && lastQuestion) {
    lastQuestion.answer = {
      transcript: input.answer.transcript,
      start_ms: input.answer.startMs,
      end_ms: input.answer.endMs,
      word_count: input.answer.wordCount,
      asr_confidence_avg: input.answer.asrConfidence,
    };
    lastQuestion.status = 'answered';
    lastQuestion.partially_heard = input.answer.partiallyHeard;

    const ingest = ingestAnswer(
      state.coverage,
      blueprint,
      lastQuestion,
      input.answer.transcript,
      state.runtime.turn,
    );

    state.coverage = ingest.coverage;
    newlyVerified = ingest.newlyVerified;
    answerWeak = ingest.weak;
    disclaimed = ingest.disclaimed;

    state.runtime.consecutive_weak_answers = answerWeak
      ? state.runtime.consecutive_weak_answers + 1
      : 0;

    if (disclaimed && lastQuestion.goal_id) {
      state.runtime.dont_know_by_goal[lastQuestion.goal_id] =
        (state.runtime.dont_know_by_goal[lastQuestion.goal_id] ?? 0) + 1;
    }
  }

  state.runtime.turn += 1;
  state.runtime.elapsed_sec = input.elapsedSec;

  // ── 2 · Close goals and advance sections — ceilings, not decisions ────────
  applyGoalAndSectionProgress(state, blueprint);

  // Hard stop. O1 enforces the total ceiling above everything else, so a goal
  // that will not close can never run the interview past its budget.
  if (input.elapsedSec >= input.maxDurationSec || allSectionsDone(state, blueprint)) {
    state.runtime.finished = true;
    return finish(state, newlyVerified);
  }

  // ── 3 · §4 pre-filter ────────────────────────────────────────────────────
  const ruleInput: RuleInput = {
    blueprint,
    coverage: state.coverage,
    runtime: state.runtime,
    memory: openCallbacks(state.memory, 3),
    lastQuestion: lastQuestion
      ? {
          skill_tags: lastQuestion.skill_tags,
          entry_style: undefined,
          text: lastQuestion.text,
        }
      : undefined,
    lastAnswerSec: input.answer?.durationSec,
    lastAnswerWeak: answerWeak,
    sectionElapsedSec: input.elapsedSec,
  };

  const shortlist = legalActions(ruleInput);

  // ── 4 · L1 · blocking, ≤550ms hard ───────────────────────────────────────
  const section = blueprint.sections.find((s) => s.section_id === state.runtime.current_section_id);

  const l1 = await runConversationManager(
    {
      shortlist,
      coverage: state.coverage,
      runtime: state.runtime,
      callbacks: openCallbacks(state.memory, 3),
      sectionTitle: section?.title ?? 'Interview',
      goalStatements: goalStatements(blueprint),
      lastAnswerSignal: {
        wordCount: input.answer?.wordCount ?? 0,
        durationSec: input.answer?.durationSec ?? 0,
        newEvidenceCount: newlyVerified.length,
        disclaimed,
        weak: answerWeak,
      },
    },
    context,
  );

  // ── 5 · §4 post-validation ───────────────────────────────────────────────
  let intent = l1.intent;
  let intentRejected: string | undefined;

  const validation = validateIntent(intent, shortlist, ruleInput);
  if (!validation.valid) {
    // No time to resample inside a turn — fall back to the rule layer's own
    // top-ranked option, which is legal by construction.
    intentRejected = validation.reason;
    intent = intentFromAction(shortlist[0], intent);
  }

  if (intent.action === 'CLOSE_INTERVIEW') {
    state.runtime.finished = true;
    return finish(state, newlyVerified);
  }

  // ── 6 · Resolve what will actually be said ───────────────────────────────
  const chosen = matchAction(shortlist, intent);
  const resolved = resolveQuestionText(blueprint, intent, chosen);

  const callbackItem =
    intent.action === 'CALLBACK' && intent.callback_memory_id
      ? state.memory.items.find((i) => i.item_id === intent.callback_memory_id)
      : undefined;

  const nextSection = intent.action === 'TRANSITION_SECTION'
    ? nextSectionAfter(blueprint, state.runtime.current_section_id)
    : undefined;

  // ── 7 · L4 · blocking, ≤350ms hard ───────────────────────────────────────
  const l4 = await runDialogueStyler(
    {
      intent,
      questionText: resolved.text,
      exitTransition: section?.exit_transitions[0],
      entryTransition: nextSection?.entry_transitions[0],
      callbackNouns: callbackItem ? callbackNouns(callbackItem) : undefined,
      persona: input.persona,
      runtime: state.runtime,
      isFirstQuestion: state.questions.length === 0,
    },
    context,
  );

  const { plan, repairs } = validateAndRepairPlan(l4.plan, state.runtime, {
    callbackNouns: callbackItem ? callbackNouns(callbackItem) : undefined,
  });

  // ── 8 · Record the question and update the runtime ───────────────────────
  const questionId = `q_${String(state.questions.length + 1).padStart(2, '0')}`;

  const record: QuestionRecord = {
    question_id: questionId,
    seq: state.questions.length + 1,
    turn: state.runtime.turn,
    section_id: nextSection?.section_id ?? state.runtime.current_section_id,
    // The intent's nullable fields become optional on the question record —
    // `undefined` is the right shape for a JSONB column, where a null would
    // serialise as an explicit null for no reason.
    goal_id: intent.target_goal ?? undefined,
    bank_id: resolved.bankId,
    origin: resolved.origin,
    text: plan.utterance,
    as_spoken: [plan.acknowledgement, plan.transition, plan.utterance].filter(Boolean).join(' '),
    targets_evidence: intent.missing_evidence.length
      ? intent.missing_evidence
      : (chosen?.targets_evidence ?? []),
    skill_tags: chosen?.skill_tags ?? [],
    difficulty: state.runtime.current_difficulty,
    grading_mode: resolved.gradingMode,
    weight: 1,
    rubric: resolved.rubric,
    intent_snapshot: intent,
    utterance_plan: plan,
    asked_at: new Date().toISOString(),
    status: 'asked',
  };

  state.questions.push(record);
  applyRuntimeUpdates(state, intent, plan, resolved, nextSection?.section_id, chosen);

  if (callbackItem) state.memory = markCallbackSpent(state.memory, callbackItem.item_id);

  // ── 9 · L2 · ASYNC, never blocking (§2.3) ────────────────────────────────
  // Deliberately not awaited: memory pays off from the NEXT turn onward, and
  // blocking on it would double turn latency for nothing.
  if (input.answer && lastQuestion) {
    void runMemoryExtraction(
      {
        questionText: lastQuestion.text,
        answerTranscript: input.answer.transcript,
        openGoalIds: state.coverage.goals
          .filter((g) => g.status === 'in_progress' || g.status === 'not_started')
          .map((g) => g.goal_id),
        knownLabels: state.memory.items.map((i) => i.label),
      },
      context,
    ).catch(() => null);
  }

  return {
    state,
    utterance: {
      questionId,
      plan,
      cacheText: plan.utterance,
      bankId: resolved.bankId,
    },
    finished: false,
    intent,
    diagnostics: {
      l1LatencyMs: l1.latencyMs,
      l4LatencyMs: l4.latencyMs,
      l1Fallback: l1.fromFallback,
      l4Fallback: l4.fromFallback,
      ruleRepairs: repairs,
      intentRejected,
      newlyVerified,
    },
  };
}

/**
 * Applies the L2 extraction that turn N kicked off. Called separately so the
 * async work can land without ever having blocked a turn.
 */
export function applyMemoryExtraction(
  state: LiveState,
  extraction: Parameters<typeof mergeExtraction>[1],
  meta: { turn: number; questionId: string },
): LiveState {
  return { ...state, memory: mergeExtraction(state.memory, extraction, meta) };
}

// ── Internals ────────────────────────────────────────────────────────────────

type BlueprintSection = Blueprint['sections'][number];

function applyGoalAndSectionProgress(state: LiveState, blueprint: Blueprint): void {
  const activeId = state.runtime.active_goal_id;
  if (activeId) {
    const goalState = state.coverage.goals.find((g) => g.goal_id === activeId);
    const bpGoal = findBlueprintGoal(blueprint, activeId);

    if (goalState && bpGoal && goalState.status === 'in_progress') {
      const exit = checkGoalExit(goalState, bpGoal, {
        consecutiveWeak: state.runtime.consecutive_weak_answers,
        dontKnowCount: state.runtime.dont_know_by_goal[activeId] ?? 0,
      });

      if (exit.triggered) {
        // Abandoned goals are scored on the evidence actually gathered and
        // flagged incomplete — never scored as zero (§9.6).
        goalState.status = exit.reason === 'evidence_complete' ? 'satisfied' : 'abandoned';
        state.runtime.active_goal_id = null;
        state.runtime.turns_on_active_goal = 0;
      }
    }
  }

  if (isSectionComplete(state.coverage, state.runtime.current_section_id)) {
    if (!state.runtime.sections_completed.includes(state.runtime.current_section_id)) {
      state.runtime.sections_completed.push(state.runtime.current_section_id);
    }
    const next = nextSectionAfter(blueprint, state.runtime.current_section_id);
    if (next) {
      state.runtime.current_section_id = next.section_id;
      state.runtime.active_goal_id = null;
      state.runtime.turns_on_active_goal = 0;
    }
  }
}

function allSectionsDone(state: LiveState, blueprint: Blueprint): boolean {
  return blueprint.sections.every((s) => isSectionComplete(state.coverage, s.section_id));
}

function nextSectionAfter(blueprint: Blueprint, sectionId: string): BlueprintSection | undefined {
  const idx = blueprint.sections.findIndex((s) => s.section_id === sectionId);
  return idx >= 0 ? blueprint.sections[idx + 1] : undefined;
}

function findBlueprintGoal(blueprint: Blueprint, goalId: string) {
  for (const section of blueprint.sections) {
    const goal = section.goals.find((g) => g.goal_id === goalId);
    if (goal) return goal;
  }
  return undefined;
}

function goalStatements(blueprint: Blueprint): Record<string, string> {
  const map: Record<string, string> = {};
  for (const section of blueprint.sections) {
    for (const goal of section.goals) map[goal.goal_id] = goal.statement;
  }
  return map;
}

function matchAction(
  shortlist: CandidateAction[],
  intent: ConversationalIntent,
): CandidateAction | undefined {
  return (
    shortlist.find(
      (c) => c.source_kind === intent.source_kind && c.source_id === intent.source_id,
    ) ?? shortlist.find((c) => c.action === intent.action)
  );
}

interface ResolvedQuestion {
  text?: string;
  bankId?: string;
  rubric?: unknown;
  gradingMode: QuestionRecord['grading_mode'];
  origin: QuestionRecord['origin'];
  entryStyle?: CandidateAction['entry_style'];
}

/**
 * Pulls the verbatim question text and its plan-time rubric out of the
 * blueprint. The rubric travels with the question because it must grade the
 * exact words that were asked (invariant 6).
 */
function resolveQuestionText(
  blueprint: Blueprint,
  intent: ConversationalIntent,
  chosen: CandidateAction | undefined,
): ResolvedQuestion {
  if (intent.action === 'TRANSITION_SECTION') {
    return { gradingMode: 'experiential', origin: 'closing' };
  }

  if (intent.source_kind === 'bank' && intent.source_id) {
    for (const section of blueprint.sections) {
      for (const goal of section.goals) {
        const q = goal.question_bank.find((b) => b.bank_id === intent.source_id);
        if (q) {
          return {
            text: q.text,
            bankId: q.bank_id,
            rubric: q.rubric,
            gradingMode: q.grading_mode,
            origin: 'bank',
            entryStyle: q.entry_style,
          };
        }
      }
    }
  }

  if (intent.source_kind === 'followup_bank' && intent.source_id) {
    for (const section of blueprint.sections) {
      for (const goal of section.goals) {
        const f = goal.followup_bank.find((b) => b.followup_id === intent.source_id);
        if (f) {
          // A follow-up inherits the grading mode of its goal's bank, so a probe
          // into someone's own project is never graded as a factual question.
          const mode = goal.question_bank[0]?.grading_mode ?? 'experiential';
          return { text: f.text, rubric: undefined, gradingMode: mode, origin: 'followup' };
        }
      }
    }
  }

  if (intent.action === 'CALLBACK') {
    return { text: chosen?.text, gradingMode: 'experiential', origin: 'callback' };
  }

  return { text: chosen?.text, gradingMode: 'experiential', origin: 'bank' };
}

function applyRuntimeUpdates(
  state: LiveState,
  intent: ConversationalIntent,
  plan: UtterancePlan,
  resolved: ResolvedQuestion,
  nextSectionId: string | undefined,
  chosen: CandidateAction | undefined,
): void {
  const rt = state.runtime;

  if (resolved.bankId) rt.asked_bank_ids.push(resolved.bankId);
  if (intent.source_kind === 'followup_bank' && intent.source_id) {
    rt.asked_followup_ids.push(intent.source_id);
  }

  if (plan.acknowledgement) {
    rt.recent_acknowledgements = [...rt.recent_acknowledgements, plan.acknowledgement.trim()].slice(-8);
  }
  if (chosen?.skill_tags.length) {
    rt.recent_skill_tags = [...rt.recent_skill_tags, ...chosen.skill_tags].slice(-8);
  }
  if (resolved.entryStyle) {
    rt.recent_entry_styles = [...rt.recent_entry_styles, resolved.entryStyle].slice(-4);
  }

  if (intent.action === 'CALLBACK') rt.last_callback_turn = rt.turn;
  if (intent.action === 'CORRECT_AND_CONTINUE') rt.corrections_used += 1;

  if (nextSectionId) {
    rt.current_section_id = nextSectionId;
    rt.active_goal_id = null;
    rt.turns_on_active_goal = 0;
  } else if (intent.target_goal) {
    if (rt.active_goal_id === intent.target_goal) {
      rt.turns_on_active_goal += 1;
    } else {
      rt.active_goal_id = intent.target_goal;
      rt.turns_on_active_goal = 1;
    }
  }

  // R4 bounds are enforced in validateIntent; this only applies the delta and
  // tracks the no-yo-yo window.
  if (intent.difficulty_delta !== 0) {
    const max = state.strategy?.difficulty_curve.max_level ?? 5;
    const min = Math.max(1, (state.strategy?.difficulty_curve.start_level ?? 2) - 1);
    rt.current_difficulty = Math.min(max, Math.max(min, rt.current_difficulty + intent.difficulty_delta));
    rt.turns_since_difficulty_drop = intent.difficulty_delta === -1 ? 0 : rt.turns_since_difficulty_drop + 1;
  } else {
    rt.turns_since_difficulty_drop += 1;
  }
}

function intentFromAction(
  action: CandidateAction | undefined,
  original: ConversationalIntent,
): ConversationalIntent {
  if (!action) return { ...original, action: 'TRANSITION_SECTION', transition_type: 'section_change' };

  return {
    ...original,
    action: action.action,
    target_goal: action.goal_id ?? null,
    target_skill: action.skill_tags[0] ?? null,
    missing_evidence: action.targets_evidence.slice(0, 4),
    source_kind: action.source_kind,
    source_id: action.source_id ?? null,
    transition_type: action.action === 'TRANSITION_SECTION' ? 'section_change' : 'none',
    difficulty_delta: 0,
    callback_memory_id: action.action === 'CALLBACK' ? (action.source_id ?? null) : null,
    reason: 'Rule-layer fallback after post-validation rejected the model intent.',
  };
}

function finish(state: LiveState, newlyVerified: string[]): TurnOutput {
  state.runtime.finished = true;
  return {
    state,
    utterance: null,
    finished: true,
    intent: null,
    diagnostics: {
      l1LatencyMs: 0,
      l4LatencyMs: 0,
      l1Fallback: false,
      l4Fallback: false,
      ruleRepairs: [],
      newlyVerified,
    },
  };
}

export { pickAcknowledgement };
