/**
 * O1 · The live turn cycle.
 *
 *   answer → L3 lexical ingest (<40ms) → IV interviewer (one Groq call)
 *          → §4 structural overrides (~1ms) → speech      ⟂ L3v, L2 off-path
 *
 * ── One model call, and it does everything ──────────────────────────────────
 * §2.2 put L1 (deciding) and L4 (wording) in series inside this path, and the
 * candidate paid for both in silence after every answer. A later revision took
 * them out entirely and deferred adaptivity to a second HTTP request, which
 * removed the silence but meant the question asked next was always one P6 had
 * written in advance.
 *
 * Neither arrangement is here now. `IV` decides AND speaks in a single call on
 * a provider fast enough to do it inside the turn (see lib/agents/interviewer.ts
 * for why the D2/D3 split is deliberately not preserved). The interviewer writes
 * its own questions against what the candidate actually said, digs into an
 * answer immediately rather than two turns later, and can answer a question
 * asked back at it.
 *
 * ── What the orchestrator still owns ────────────────────────────────────────
 * Invariant 1 holds: no interview decision is made in this file. It sequences,
 * it persists, and it enforces ceilings the blueprint and the strategy already
 * set — the section question budget, the two-strike rule, the difficulty step,
 * the hard time stop. The interviewer proposes; `applyStructuralRules` disposes.
 * That is D8 unchanged: constraints in code, judgement in the model.
 */

import type {
  Blueprint,
  ConversationalIntent,
  InterviewerTurn,
  UtterancePlan,
} from '../agents/schemas';
import { runInterviewer, type InterviewerInput } from '../agents/interviewer';
import { DIFFICULTY_BRIEF } from '../agents/p5-strategy';
import { runMemoryExtraction } from '../agents/l2-memory';
import { mergeExtraction, openCallbacks, type InterviewMemory } from '../engine/l2-memory-store';
import {
  applyEvidenceVerdicts,
  buildRubric,
  checkGoalExit,
  ingestAnswer,
  isSectionComplete,
} from '../engine/l3-evidence';
import { runEvidenceCheck } from '../agents/l3-verify';
import {
  ACKNOWLEDGEMENT_POOL,
  isRepeatQuestion,
  legalActions,
  pickAcknowledgement,
  validateAndRepairPlan,
  type RuleInput,
} from '../engine/rules';
import {
  NO_FLOOR_SECTIONS,
  SECTION_QUESTION_BUDGET,
  withRuntimeDefaults,
  type CandidateAction,
  type Coverage,
  type QuestionRecord,
  type SessionRuntime,
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
  /** Sets R12's per-section question budget. Defaults to medium. */
  difficulty?: 'easy' | 'medium' | 'hard';
}

/*
 * ── L6 and `/reflect` are gone, and both for the same reason ────────────────
 *
 * L6 answered a question the candidate asked back, behind a regex gate that
 * guessed whether the last answer was really a question. `/reflect` generated a
 * dig-deeper probe in a second HTTP request and queued it for a turn or two
 * later, because the turn had no budget to write one.
 *
 * The interviewer does both, in the turn, from the conversation itself:
 * ANSWER_QUESTION replaces the first and DEEP_DIVE the second. Neither needs a
 * heuristic to detect the situation, because the model can see it — and a probe
 * that arrives immediately is worth more than one that arrives after the
 * candidate has moved on twice.
 *
 * The employer material L6 needed now lives in `blueprint.context`, which the
 * interviewer already reads on every turn.
 */

export interface TurnOutput {
  state: LiveState;
  /** Null when the interview just ended. */
  utterance: {
    questionId: string;
    plan: UtterancePlan;
    /** Cache key: a clip is played only when its text matches exactly. */
    cacheText: string;
    bankId?: string;
    /**
     * What this question is trying to establish, resolved as it is asked.
     *
     * Not a new decision and not a new model call: the interviewer already
     * named `target_goal`, `resolveGeneratedQuestion` already joined it to the
     * evidence, and P6 wrote both before the interview began. This is a lookup
     * over objects already in memory — the whole reason it can be surfaced
     * without costing the turn a millisecond.
     *
     * It exists so the candidate can see what a question is FOR while they are
     * answering it, and so the report's goal outcomes are the same statements
     * the candidate was shown rather than a post-hoc reconstruction.
     */
    goal: {
      goal_id: string;
      statement: string;
      /** The specific evidence descriptions this question is aimed at. */
      pursuing: string[];
    } | null;
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
    /** What the interviewer decided to do. Read by ops queries on agent_runs. */
    action?: ConversationalIntent['action'];
    newlyVerified: string[];
  };
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const state: LiveState = structuredClone(input.state);
  // A deploy can land mid-interview, so a checkpoint written by an older build
  // may be missing counters the rules below compare against.
  state.runtime = withRuntimeDefaults(state.runtime);
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

  /*
   * ── 1b · L3v · launched here, awaited after L4 ───────────────────────────
   *
   * Started before L1 and collected once the two blocking calls are done, so
   * the model's read of what the answer established costs no wall clock. Its
   * verdicts are merged at the end of this turn, which puts them in coverage
   * before the NEXT turn builds its shortlist — exactly the refinement window
   * §12 describes.
   *
   * The lexical marks stand for this turn's decision either way. This can only
   * ever add evidence, never retract it.
   */
  const verifying =
    input.answer && lastQuestion?.goal_id
      ? startEvidenceCheck(state, blueprint, lastQuestion, input.answer.transcript, context)
      : null;

  state.runtime.turn += 1;
  state.runtime.elapsed_sec = input.elapsedSec;

  /** Folds L3v's verdicts into coverage. Safe to call more than once. */
  let collected = false;
  const collectVerdicts = async (): Promise<void> => {
    if (collected || !verifying || !lastQuestion?.goal_id) return;
    collected = true;

    const { verdicts } = await verifying;
    if (verdicts.length === 0) return;

    const merged = applyEvidenceVerdicts(state.coverage, blueprint, {
      goalId: lastQuestion.goal_id,
      questionId: lastQuestion.question_id,
      turn: state.runtime.turn,
      verdicts,
    });

    state.coverage = merged.coverage;
    newlyVerified = [...new Set([...newlyVerified, ...merged.newlyVerified])];
  };

  // ── 2 · Close goals and advance sections — ceilings, not decisions ────────
  applyGoalAndSectionProgress(state, blueprint);

  // Hard stop. O1 enforces the total ceiling above everything else, so a goal
  // that will not close can never run the interview past its budget.
  if (input.elapsedSec >= input.maxDurationSec || allSectionsDone(state, blueprint)) {
    // Latency no longer matters on the last turn, and the final answer's
    // evidence belongs in the report as much as any other.
    await collectVerdicts();
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
    // Seconds inside THIS section. It used to be handed the whole interview's
    // elapsed time, which made every section look like it had already blown its
    // ceiling — so the check it feeds was meaningless.
    sectionElapsedSec: Math.max(0, input.elapsedSec - state.runtime.section_started_sec),
    difficulty: input.difficulty,
  };

  const shortlist = legalActions(ruleInput);
  const section = blueprint.sections.find((s) => s.section_id === state.runtime.current_section_id);

  /*
   * ── 4 · The interviewer decides and speaks ───────────────────────────────
   *
   * One model call, on Groq, and the only one inside the turn. It reads the
   * section brief, what is still outstanding, and the last few exchanges, and
   * it writes the actual sentence the candidate hears.
   *
   * The blueprint is a map, not a route. This is where the driving happens —
   * following what the candidate opened up, digging into what they just said,
   * answering when they ask something back, and still arriving at the
   * milestones. What it cannot do is override structure: the section budget,
   * the two-strike rule and the time ceiling are enforced below, in code,
   * whatever it decides (D8 — constraints belong in code, judgement in the
   * model).
   */
  const budget = SECTION_QUESTION_BUDGET[input.difficulty ?? 'medium'];
  const nextUp = nextSectionAfter(blueprint, state.runtime.current_section_id);

  /*
   * ── The clock, computed once ────────────────────────────────────────────
   *
   * P6 estimates each section (`time_budget_sec`, rescaled to the interview's
   * real ceiling); this measures what has actually been spent in it. Both the
   * interviewer's prompt and the structural rules below read the SAME derived
   * pace, because a prompt that says "you have room" while the rules force a
   * handoff produces a question that is written and then thrown away.
   *
   * `ahead` is deliberately generous — under 70% of the budget — so that "you
   * have time, go deeper" fires while there is genuinely time to go deeper in,
   * rather than at the ninety-second mark when there is not.
   */
  const sectionElapsedSec = Math.max(0, input.elapsedSec - state.runtime.section_started_sec);
  const sectionBudgetSec = section?.time_budget_sec ?? 240;
  const sectionCeilingSec = section?.time_ceiling_sec ?? Math.round(sectionBudgetSec * 1.25);
  const remainingSec = Math.max(0, input.maxDurationSec - input.elapsedSec);
  const pace: 'ahead' | 'on_track' | 'over' =
    sectionElapsedSec >= sectionCeilingSec
      ? 'over'
      : sectionElapsedSec < sectionBudgetSec * 0.7
        ? 'ahead'
        : 'on_track';

  const iv = section
    ? await runInterviewer(
        {
          context: blueprint.context,
          section: {
            title: section.title,
            type: section.type,
            objective: section.objective,
            question_focus: section.question_focus,
            must_verify: section.must_verify,
          },
          goals: openGoalsInSection(state, blueprint, section.section_id),
          seeds: unaskedSeeds(state, section),
          // Every question asked so far. Bounded by the interview's own length
          // (~25 short strings) and the one thing that must never be forgotten.
          askedQuestions: state.questions.map((q) => q.text).filter(Boolean),
          recentTurns: recentExchanges(state, RECENT_TURN_WINDOW),
          memory: openCallbacks(state.memory, 3),
          runtime: state.runtime,
          sectionBudget: { asked: state.runtime.questions_in_section, ...budget },
          nextSection: nextUp ? { title: nextUp.title, type: nextUp.type } : null,
          timing: {
            sectionElapsedSec,
            sectionBudgetSec,
            elapsedSec: input.elapsedSec,
            remainingSec,
            pace,
          },
          difficultyBrief: DIFFICULTY_BRIEF[input.difficulty ?? 'medium'],
          lastAnswerSignal: input.answer
            ? {
                wordCount: input.answer.wordCount,
                newEvidenceCount: newlyVerified.length,
                disclaimed,
                weak: answerWeak,
              }
            : null,
          persona: input.persona,
        },
        context,
      )
    : null;

  /*
   * ── 5 · Structure is enforced here, not requested in the prompt ──────────
   *
   * D8's rule, applied to an agent that now writes its own questions. It can
   * choose anything; these decide whether it is allowed to have chosen it.
   */
  const decided = applyStructuralRules({
    proposed: iv?.turn ?? null,
    runtime: state.runtime,
    coverage: state.coverage,
    section,
    hasNextSection: Boolean(nextUp),
    budget,
    seeds: section ? unaskedSeeds(state, section) : [],
    askedQuestions: state.questions.map((q) => q.text).filter(Boolean),
    goalsOpen: section ? openGoalsInSection(state, blueprint, section.section_id).length : 0,
    nextSectionOpener: nextUp?.goals[0]?.question_bank[0]?.text ?? null,
    pace,
    remainingSec,
    fallback: () => ruleLayerIntent(shortlist[0], answerWeak),
  });

  const intent = decided.intent;
  const intentRejected = decided.overrideReason;

  if (intent.action === 'CLOSE_INTERVIEW') {
    await collectVerdicts();
    closeOutSection(state, state.runtime.current_section_id);
    state.runtime.finished = true;
    return finish(state, newlyVerified);
  }

  /*
   * A clarification is NOT an answer.
   *
   * "Which Spark do you mean?" is the candidate asking what the question was,
   * and grading it against the rubric for the question they were asking about
   * would score them as having failed to answer something they never got a
   * clear version of. So the previous question stops being a graded record and
   * the turn re-asks it properly.
   */
  if (decided.previousWasNotAnAnswer && lastQuestion) {
    lastQuestion.status = 'skipped';
    state.runtime.consecutive_weak_answers = 0;
    if (lastQuestion.goal_id) {
      state.runtime.dont_know_by_goal[lastQuestion.goal_id] = Math.max(
        0,
        (state.runtime.dont_know_by_goal[lastQuestion.goal_id] ?? 0) - 1,
      );
    }
  }

  // ── 6 · Resolve what will actually be said ───────────────────────────────
  const nextSection = intent.action === 'TRANSITION_SECTION'
    ? nextSectionAfter(blueprint, state.runtime.current_section_id)
    : undefined;

  /*
   * Leaving the last section IS the end of the interview.
   *
   * Without this, `applyRuntimeUpdates` finds no section to move to, leaves
   * `current_section_id` untouched, and the loop asks the closing section for
   * another question — forever, or until the global time ceiling cut it off.
   */
  if (intent.action === 'TRANSITION_SECTION' && !nextSection) {
    await collectVerdicts();
    closeOutSection(state, state.runtime.current_section_id);
    state.runtime.finished = true;
    return finish(state, newlyVerified);
  }

  /*
   * The section this question belongs to — the one being ENTERED on a handoff.
   *
   * `grading_mode` follows from it, and that matters most for the two module
   * rounds: a transition INTO the coding or skill section is the utterance the
   * submission is recorded against, so if it is not graded in that mode,
   * `aggregateSession` finds no questions of it and the whole round — and the
   * module fee paid for it — produces nothing on the report.
   */
  const targetSection = nextSection ?? section;
  const activeGoal = intent.target_goal
    ? findBlueprintGoal(blueprint, intent.target_goal)
    : undefined;

  const resolved = resolveGeneratedQuestion({
    utterance: decided.utterance,
    goal: activeGoal,
    targetsEvidence: intent.missing_evidence,
    sectionType: targetSection?.type,
    isTransition: intent.action === 'TRANSITION_SECTION',
    seedBankId: decided.seedBankId,
  });

  /*
   * ── 7 · Wording ─────────────────────────────────────────────────────────
   *
   * Already done. The interviewer wrote the sentence, so there is no second
   * model call to turn a decision into words — that was the whole reason D2/D3
   * split L1 from L4, and merging them is what buys the turn its latency back.
   *
   * The rule layer still gets the last word on the acknowledgement: R5 bars
   * evaluative feedback and R6 bars repeating a phrase inside four turns, and
   * both are checked here, in code, on the way to the speaker.
   */
  const displayedGoal = describeGoal(activeGoal, targetSection, resolved.targetsEvidence);

  const plan: UtterancePlan = {
    acknowledgement: decided.acknowledgement,
    // Handoffs speak the blueprint author's own line, so a section change
    // sounds deliberate rather than abrupt (R10).
    transition:
      intent.action === 'TRANSITION_SECTION' ? (nextSection?.entry_transitions[0] ?? '') : '',
    utterance: decided.utterance,
    prosody: {
      rate: intent.emotional_tone === 'encouraging' ? 0.95 : intent.emotional_tone === 'brisk' ? 1.05 : 1,
      emotion: intent.emotional_tone,
      emphasis: [],
      pause_after_acknowledgement_ms: 250,
    },
    expected_duration_sec: Math.max(2, Math.min(40, decided.utterance.split(/\s+/).length / 2.6)),
    allow_barge_in_after_ms: 800,
  };

  const { plan: repaired, repairs } = validateAndRepairPlan(plan, state.runtime);

  // ── 8 · Record the question and update the runtime ───────────────────────
  const questionId = `q_${String(state.questions.length + 1).padStart(2, '0')}`;

  const record: QuestionRecord = {
    question_id: questionId,
    seq: state.questions.length + 1,
    turn: state.runtime.turn,
    section_id: targetSection?.section_id ?? state.runtime.current_section_id,
    // The intent's nullable fields become optional on the question record —
    // `undefined` is the right shape for a JSONB column, where a null would
    // serialise as an explicit null for no reason.
    goal_id: intent.target_goal ?? undefined,
    // What the candidate was shown this question was for. See the field note.
    displayed_goal: displayedGoal ?? undefined,
    bank_id: resolved.bankId,
    origin: resolved.origin,
    text: repaired.utterance,
    as_spoken: [repaired.acknowledgement, repaired.transition, repaired.utterance]
      .filter(Boolean)
      .join(' '),
    targets_evidence: resolved.targetsEvidence,
    skill_tags: activeGoal?.skill_tags ?? [],
    difficulty: state.runtime.current_difficulty,
    grading_mode: resolved.gradingMode,
    weight: 1,
    // Assembled from the evidence this question aims at, so a question written
    // thirty seconds ago is graded against a rubric written before the
    // interview started (invariant 6).
    rubric: resolved.rubric,
    intent_snapshot: intent,
    utterance_plan: repaired,
    asked_at: new Date().toISOString(),
    status: 'asked',
  };

  // The interviewer call is done; the verifier has had that whole window to
  // land. Merging here puts its verdicts in coverage before the next turn is
  // decided, which is the whole point of running it early.
  await collectVerdicts();

  state.questions.push(record);
  applyRuntimeUpdates(state, intent, repaired, resolved, nextSection?.section_id);

  // A goal the interviewer declared finished is closed here rather than left to
  // time out on its own exit conditions.
  if (intent.action === 'CLOSE_GOAL' && decided.closedGoalId) {
    closeGoal(state, decided.closedGoalId);
  }

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
      plan: repaired,
      cacheText: repaired.utterance,
      bankId: resolved.bankId,
      goal: displayedGoal,
    },
    finished: false,
    intent,
    diagnostics: {
      // One model call in the turn now, not two and not zero. `l1` carries it
      // because the field names are what the interview screen and the ops
      // queries already read; the interviewer does both jobs.
      l1LatencyMs: iv?.latencyMs ?? 0,
      l4LatencyMs: 0,
      l1Fallback: iv?.fromFallback ?? true,
      l4Fallback: false,
      ruleRepairs: repairs,
      intentRejected,
      newlyVerified,
      action: intent.action,
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
type BlueprintGoal = BlueprintSection['goals'][number];

/**
 * How many recent exchanges the interviewer sees.
 *
 * The whole transcript is what §10 forbids and §12 tracks as the risk that
 * kills a live agent by turn twenty. Four exchanges is enough to answer "which
 * Spark do you mean" and to dig into what was just said; everything older
 * reaches it through L2's structured memory instead, which is what that
 * component is for.
 */
const RECENT_TURN_WINDOW = 4;

/** Open goals in the current section, with what each still needs. */
function openGoalsInSection(
  state: LiveState,
  blueprint: Blueprint,
  sectionId: string,
): InterviewerInput['goals'] {
  const section = blueprint.sections.find((s) => s.section_id === sectionId);
  if (!section) return [];

  const out: InterviewerInput['goals'] = [];

  for (const goal of section.goals) {
    const cov = state.coverage.goals.find((g) => g.goal_id === goal.goal_id);
    if (!cov || cov.status === 'satisfied' || cov.status === 'abandoned') continue;

    const described = new Map(goal.evidence_required.map((e) => [e.evidence_id, e.description]));

    out.push({
      goal_id: goal.goal_id,
      statement: goal.statement,
      active: state.runtime.active_goal_id === goal.goal_id,
      outstanding: cov.outstanding.map((id) => ({
        evidence_id: id,
        description: described.get(id) ?? id,
      })),
    });
  }

  return out;
}

/**
 * Seed questions not yet used.
 *
 * Filtered on the recorded TEXT as well as the bank id. The id is the primary
 * record, but a seed only retires if the turn remembered to record it, and this
 * is the check that does not depend on that having happened.
 */
function unaskedSeeds(
  state: LiveState,
  section: BlueprintSection,
): Array<{ bank_id: string; text: string; goal_id: string }> {
  const spoken = new Set(state.questions.map((q) => q.text));

  return section.goals
    .flatMap((g) => g.question_bank.map((q) => ({ q, goal_id: g.goal_id })))
    .filter(
      ({ q }) => !state.runtime.asked_bank_ids.includes(q.bank_id) && !spoken.has(q.text),
    )
    .slice(0, 3)
    // `goal_id` rides along so a substituted seed can retarget the turn to the
    // goal that seed actually serves. Without it the rules could swap in a
    // question from one goal while the turn still claimed another — invisible
    // before, and wrong on screen now that the goal is shown to the candidate.
    .map(({ q, goal_id }) => ({ bank_id: q.bank_id, text: q.text, goal_id }));
}

/** The rolling transcript window. Oldest first. */
function recentExchanges(state: LiveState, count: number): Array<{ question: string; answer: string }> {
  return state.questions
    .filter((q) => q.answer?.transcript?.trim())
    .slice(-count)
    .map((q) => ({
      question: q.text,
      // Long answers are trimmed rather than dropped: the tail is usually where
      // the specifics are, and this has to stay a fixed-size input.
      answer: (q.answer!.transcript ?? '').slice(0, 600),
    }));
}

interface StructuralDecision {
  intent: ConversationalIntent;
  utterance: string;
  acknowledgement: string;
  /** Set when the interviewer declared a goal finished. */
  closedGoalId?: string;
  /** Set when the utterance came verbatim from a seed question. */
  seedBankId?: string;
  /** True when the last "answer" was really a question back at us. */
  previousWasNotAnAnswer: boolean;
  /** Populated when code overrode the interviewer's choice. */
  overrideReason?: string;
}

/**
 * §4, applied to an agent that writes its own questions.
 *
 * D8's split is unchanged: constraints run in code, judgement runs in the
 * model. What changed is that there is no candidate set to pre-filter any more,
 * so the rules that used to remove options now override outcomes instead.
 *
 * These are the ones that MUST hold, because each of them is the reason the
 * interview terminates or the reason it stays fair:
 *
 *   R12  a section gets a bounded number of questions — the only thing that
 *        guarantees the interview advances section by section
 *   R9   two strikes on a goal and we stop pressing; also the distress rule
 *   R4   difficulty never jumps more than a step
 *
 * The ones that softened to prompt guidance — no two similar questions in a
 * row, vary the question kind — are noted in `rules.ts`. They were compensating
 * for a selector picking mechanically by evidence gap, which is not what is
 * choosing any more.
 */
function applyStructuralRules(args: {
  proposed: InterviewerTurn | null;
  runtime: SessionRuntime;
  coverage: Coverage;
  section: BlueprintSection | undefined;
  hasNextSection: boolean;
  budget: { min: number; max: number };
  /** Unused seeds, for R1's substitution when a repeat is caught. */
  seeds: Array<{ bank_id: string; text: string; goal_id: string }>;
  askedQuestions: string[];
  goalsOpen: number;
  /**
   * The next section's own opening question.
   *
   * Needed because a transition can be FORCED — by the question ceiling, by two
   * strikes, or by the clock — and in that case the utterance the interviewer
   * wrote belongs to the section being left. Spoken after the new section's
   * entry line it lands as a non-sequitur: "let's move on to the coding round.
   * How did you index that table?"
   */
  nextSectionOpener: string | null;
  /** Where the section stands against the time P6 estimated for it. */
  pace: 'ahead' | 'on_track' | 'over';
  /** Seconds left in the whole interview. */
  remainingSec: number;
  fallback: () => ConversationalIntent | null;
}): StructuralDecision {
  const { proposed, runtime, section, hasNextSection, budget } = args;

  // No interviewer at all (no section, or the call failed with no fallback).
  if (!proposed) {
    const rule = args.fallback();
    return {
      intent: rule ?? { ...ruleLayerIntent(undefined, false), action: 'CLOSE_INTERVIEW' },
      utterance: '',
      acknowledgement: pickAcknowledgement(runtime),
      previousWasNotAnAnswer: false,
      overrideReason: 'no interviewer decision available',
    };
  }

  let action = proposed.action;
  let utterance = proposed.utterance.trim();
  let seedBankId: string | undefined;
  let overrideReason: string | undefined;
  /*
   * Set when a rule swapped in a seed belonging to a different goal.
   *
   * The rules pick a substitute from every unused seed in the section, which is
   * right — the point is to find something unasked — but it can hand back a
   * question written for another goal while the turn still claims the one the
   * interviewer named. That mismatch was harmless while nothing read it; it is
   * not now that the goal is shown to the candidate and recorded for the
   * report, so the turn follows the question rather than the other way round.
   */
  let retargetGoalId: string | undefined;

  const asked = runtime.questions_in_section ?? 0;

  /*
   * ── R1 · the question must not be one already asked ──────────────────────
   *
   * Enforced here rather than requested in the prompt, and that is the whole
   * point of D8: a repeated question is the single most obvious way an
   * interviewer stops sounding like it listened, and a rule a model is merely
   * asked to remember holds most of the time — with the failures landing
   * exactly where they are noticed.
   *
   * The escalation is deliberate. Substituting an unused seed keeps the turn
   * on-topic and definitely new; closing the goal admits there is nothing left
   * to ask about it; leaving the section is the last resort. Re-asking is never
   * one of the options.
   */
  const asksSomething =
    action === 'ASK' || action === 'DEEP_DIVE' || action === 'REDIRECT' || action === 'CLOSE_GOAL';

  if (asksSomething && isRepeatQuestion(utterance, args.askedQuestions)) {
    const seed = args.seeds.find((q) => !isRepeatQuestion(q.text, args.askedQuestions));

    if (seed) {
      utterance = seed.text;
      seedBankId = seed.bank_id;
      retargetGoalId = seed.goal_id;
      action = 'ASK';
      overrideReason = 'R1: question already asked — substituted an unused seed';
    } else if (args.goalsOpen > 1) {
      action = 'CLOSE_GOAL';
      overrideReason = 'R1: question already asked and no unused material on this goal';
    } else if (hasNextSection && asked >= budget.min) {
      action = 'NEXT_SECTION';
      overrideReason = 'R1: section has no unasked material left';
    } else {
      // Nothing legal left to ask and nowhere to go. Ending beats looping.
      action = 'END_INTERVIEW';
      overrideReason = 'R1: no unasked material anywhere';
    }
  }

  /*
   * A seed spoken verbatim has to be RETIRED, however it was chosen.
   *
   * The interviewer is shown seeds as pitch examples and sometimes uses one as
   * written. If that is not recorded, the seed stays in the unused pool and is
   * offered again next turn — and the fallback, which takes the first unused
   * seed, will return the same sentence for the rest of the interview.
   */
  if (!seedBankId) {
    const spoken = args.seeds.find((q) => q.text === utterance);
    seedBankId = spoken?.bank_id;
    // Only when the interviewer named no goal of its own — its stated target
    // wins over an inference drawn from which seed it happened to reuse.
    if (spoken && !proposed.target_goal) retargetGoalId = spoken.goal_id;
  }
  const goalStuck =
    runtime.active_goal_id !== null &&
    (runtime.dont_know_by_goal[runtime.active_goal_id] ?? 0) >= 2;

  // R9 · never press a third time on something they have twice said they do not
  // know, and never keep probing after two thin answers. This protects the data
  // as much as the person: a candidate who has failed twice yields no signal.
  if (
    (goalStuck || runtime.consecutive_weak_answers >= 2) &&
    (action === 'ASK' || action === 'DEEP_DIVE')
  ) {
    action = hasNextSection && asked >= budget.min ? 'NEXT_SECTION' : 'CLOSE_GOAL';
    overrideReason = goalStuck
      ? 'R9: two strikes on this goal'
      : 'R9: two consecutive thin answers';
  }

  // R12 ceiling · the section is out of questions. This is the rule that makes
  // the interview terminate section by section, so it overrides everything.
  if (asked >= budget.max && action !== 'END_INTERVIEW') {
    action = hasNextSection ? 'NEXT_SECTION' : 'END_INTERVIEW';
    overrideReason = 'R12: section question ceiling reached';
  }

  /*
   * Holding a section open needs a QUESTION, not just a verdict.
   *
   * When the interviewer chooses NEXT_SECTION its utterance is a handoff line —
   * "let's move on to the coding round". Flipping the action to ASK and leaving
   * that text in place makes the interview announce a move it then does not
   * make, and the candidate is asked nothing. So a forced stay substitutes an
   * unused seed and only holds when one exists; with nothing left to ask, the
   * honest thing is to let the section end early.
   */
  const holdInSection = (reason: string): boolean => {
    const seed = args.seeds.find((q) => !isRepeatQuestion(q.text, args.askedQuestions));
    if (!seed) return false;
    action = 'ASK';
    utterance = seed.text;
    seedBankId = seed.bank_id;
    retargetGoalId = seed.goal_id;
    overrideReason = reason;
    return true;
  };

  // R12 floor · leaving early is not allowed while there is still material,
  // except in sections whose natural length is short.
  const hasFloor = section !== undefined && !NO_FLOOR_SECTIONS.has(section.type);
  if (action === 'NEXT_SECTION' && hasFloor && asked < budget.min) {
    holdInSection('R12: below the section question floor');
  }

  /*
   * ── R14 · the section's own clock ────────────────────────────────────────
   *
   * R12 counts questions; this counts minutes, and they are not the same thing.
   * A candidate who gives ninety-second answers blows a four-minute section
   * apart in three questions, and one who answers in ten words leaves it barely
   * started at the question ceiling. Enforced in code for exactly the reason
   * every other rule here is: the interviewer is TOLD the pace and asked to
   * respect it, which it mostly does — and "mostly" is how the last two
   * sections of an interview get eaten.
   *
   * Over the section ceiling wins over everything except an interviewer that
   * had already decided to leave. Below the question floor is not a defence: a
   * section that has spent its time has spent it.
   */
  if (
    args.pace === 'over' &&
    hasNextSection &&
    (action === 'ASK' || action === 'DEEP_DIVE' || action === 'REDIRECT')
  ) {
    action = 'NEXT_SECTION';
    overrideReason = 'R14: section is over its estimated time';
  }

  /*
   * The mirror of it. Leaving a section with time still on it and goals still
   * open is how an interview finishes ten minutes early having established
   * nothing — the candidate paid for those minutes and the report is thinner
   * without them. The question ceiling still overrules this, just above.
   */
  if (
    action === 'NEXT_SECTION' &&
    args.pace === 'ahead' &&
    args.goalsOpen > 0 &&
    asked < budget.max &&
    // Same exemption R12's floor takes. The warm-up should close the moment the
    // candidate is talking, and the closing is a goodbye — holding either one
    // open because there are minutes left turns a courtesy into an
    // interrogation.
    hasFloor &&
    // Never undo R1, R9 or R12: those left the section for a reason that has
    // nothing to do with the clock, and re-entering it would loop.
    overrideReason === undefined
  ) {
    holdInSection('R14: section still has time and open goals — staying');
  }

  // Nowhere left to go.
  if (action === 'NEXT_SECTION' && !hasNextSection) {
    action = 'END_INTERVIEW';
    overrideReason = 'no section remaining';
  }

  /*
   * A forced handoff must speak the NEW section's question, not the old one's.
   *
   * `overrideReason` is the tell: an interviewer that chose to move on wrote a
   * handoff line to go with it, and that is left alone. One that was moved on
   * by a rule wrote a question for the section it is being taken out of.
   */
  if (action === 'NEXT_SECTION' && overrideReason !== undefined && args.nextSectionOpener) {
    utterance = args.nextSectionOpener;
    seedBankId = undefined;
  }

  // R4 · difficulty moves one step at a time, never after a weak answer, and
  // never straight back up after a drop.
  let delta = Math.max(-1, Math.min(1, proposed.difficulty_delta));
  if (delta === 1 && (runtime.consecutive_weak_answers > 0 || runtime.turns_since_difficulty_drop < 2)) {
    delta = 0;
  }
  if (delta === -1 && runtime.consecutive_weak_answers < 1) delta = 0;

  /*
   * A clarification or a question back at us means the previous question was
   * never actually answered — so it must not be graded, and this turn does not
   * count against the section budget. Charging someone a question for asking
   * what the question meant is how an interview runs out of time being polite.
   */
  const previousWasNotAnAnswer = action === 'CLARIFY' || action === 'ANSWER_QUESTION';

  return {
    intent: {
      action: INTENT_ACTION[action],
      // `||` not `??`: the interviewer returns "" for "no goal", and an empty
      // string stored as a goal_id is an id that resolves to nothing.
      target_goal: retargetGoalId ?? (proposed.target_goal || null),
      target_skill: null,
      missing_evidence: proposed.targets_evidence.slice(0, 4),
      source_kind: 'generated',
      source_id: null,
      transition_type: action === 'NEXT_SECTION' ? 'section_change' : 'none',
      emotional_tone: proposed.emotional_tone,
      callback_memory_id: null,
      response_strategy:
        action === 'DEEP_DIVE' ? 'narrow' : action === 'CLARIFY' ? 'rephrase' : 'direct',
      difficulty_delta: delta,
      acknowledge_answer: proposed.acknowledgement.trim().length > 0,
      reason: proposed.reason,
      confidence: 0.8,
    },
    utterance,
    acknowledgement: proposed.acknowledgement.trim(),
    seedBankId,
    closedGoalId: action === 'CLOSE_GOAL' ? (proposed.target_goal || runtime.active_goal_id) ?? undefined : undefined,
    previousWasNotAnAnswer,
    overrideReason,
  };
}

/**
 * The intent recorded when the interviewer produced nothing usable.
 *
 * The rule layer is still enumerated every turn precisely for this: it costs
 * about a millisecond and it means a failed model call has a legal, on-topic
 * question to fall back to rather than a dead turn. Invariant 12 — degrade
 * texture, never terminate.
 */
function ruleLayerIntent(
  action: CandidateAction | undefined,
  weak: boolean,
): ConversationalIntent {
  return {
    action: action?.action ?? 'TRANSITION_SECTION',
    target_goal: action?.goal_id ?? null,
    target_skill: action?.skill_tags[0] ?? null,
    missing_evidence: action?.targets_evidence.slice(0, 4) ?? [],
    source_kind: 'generated',
    source_id: null,
    transition_type: action?.action === 'TRANSITION_SECTION' ? 'section_change' : 'none',
    emotional_tone: weak ? 'encouraging' : 'neutral',
    callback_memory_id: null,
    response_strategy: weak ? 'scaffold' : 'direct',
    difficulty_delta: 0,
    acknowledge_answer: true,
    reason: 'Fallback: rule-layer action (interviewer unavailable).',
    confidence: 0.4,
  };
}

/**
 * The interviewer's action, in the vocabulary the question record already uses.
 *
 * Kept as a mapping rather than by renaming the recorded enum, because
 * `intent_snapshot` is what makes a turn replayable (invariant 14) and past
 * sessions were written with these names.
 */
const INTENT_ACTION: Record<InterviewerTurn['action'], ConversationalIntent['action']> = {
  ASK: 'NEW_GOAL_QUESTION',
  DEEP_DIVE: 'PROBE_EVIDENCE',
  CLARIFY: 'PROBE_EVIDENCE',
  ANSWER_QUESTION: 'PROBE_EVIDENCE',
  REDIRECT: 'PROBE_EVIDENCE',
  CLOSE_GOAL: 'CLOSE_GOAL',
  NEXT_SECTION: 'TRANSITION_SECTION',
  END_INTERVIEW: 'CLOSE_INTERVIEW',
};

/** Marks a goal the interviewer declared finished, without ending the section. */
function closeGoal(state: LiveState, goalId: string): void {
  const goal = state.coverage.goals.find((g) => g.goal_id === goalId);
  if (!goal || goal.status === 'satisfied' || goal.status === 'abandoned') return;

  // Satisfied only when the evidence actually says so. Otherwise abandoned,
  // which §9.6 scores on what was gathered rather than as a zero.
  goal.status = goal.outstanding.length === 0 ? 'satisfied' : 'abandoned';

  if (state.runtime.active_goal_id === goalId) {
    state.runtime.active_goal_id = null;
    state.runtime.turns_on_active_goal = 0;
  }
}

/**
 * Fires the evidence verifier for the answer just given.
 *
 * Only outstanding items are sent: re-litigating something already verified
 * wastes prompt on a decision that cannot change, and the cap keeps this a
 * fixed-size call however many evidence items a goal carries.
 */
function startEvidenceCheck(
  state: LiveState,
  blueprint: Blueprint,
  lastQuestion: QuestionRecord,
  transcript: string,
  context: { userId: string; projectId: string; sessionId: string },
) {
  const goal = state.coverage.goals.find((g) => g.goal_id === lastQuestion.goal_id);
  const bpGoal = lastQuestion.goal_id ? findBlueprintGoal(blueprint, lastQuestion.goal_id) : undefined;
  if (!goal || !bpGoal) return null;

  const described = new Map(bpGoal.evidence_required.map((e) => [e.evidence_id, e.description]));

  const outstanding = goal.evidence
    .filter((e) => e.status !== 'verified')
    .slice(0, 8)
    .map((e) => ({
      evidence_id: e.evidence_id,
      description: described.get(e.evidence_id) ?? e.evidence_id,
    }));

  if (outstanding.length === 0) return null;

  // Never rejects: runAgent resolves to the fallback on timeout or error, and
  // an unhandled rejection here would take down a turn over an optional call.
  return runEvidenceCheck(
    { questionText: lastQuestion.text, answerTranscript: transcript, outstanding },
    context,
  ).catch(() => ({ verdicts: [], fromFallback: true, latencyMs: 0 }));
}

function applyGoalAndSectionProgress(state: LiveState, blueprint: Blueprint): void {
  const activeId = state.runtime.active_goal_id;

  /*
   * EVERY open goal in the section is checked, not just the active one.
   *
   * This used to look only at `active_goal_id`, which meant a goal L1 moved
   * away from was never re-evaluated — it stayed `in_progress` forever, and
   * `isSectionComplete` requires all of them to be closed. A section with three
   * goals could have two of them silently stuck open while the third was probed
   * over and over, and the section never ended.
   */
  for (const goalState of state.coverage.goals) {
    if (goalState.section_id !== state.runtime.current_section_id) continue;
    if (goalState.status !== 'in_progress') continue;

    const bpGoal = findBlueprintGoal(blueprint, goalState.goal_id);
    if (!bpGoal) continue;

    const isActive = goalState.goal_id === activeId;
    const exit = checkGoalExit(goalState, bpGoal, {
      // Consecutive weak answers are a property of the conversation, not of a
      // goal nobody is currently probing.
      consecutiveWeak: isActive ? state.runtime.consecutive_weak_answers : 0,
      dontKnowCount: state.runtime.dont_know_by_goal[goalState.goal_id] ?? 0,
    });

    if (exit.triggered) {
      // Abandoned goals are scored on the evidence actually gathered and
      // flagged incomplete — never scored as zero (§9.6).
      goalState.status = exit.reason === 'evidence_complete' ? 'satisfied' : 'abandoned';
      if (isActive) {
        state.runtime.active_goal_id = null;
        state.runtime.turns_on_active_goal = 0;
      }
    }
  }

  if (isSectionComplete(state.coverage, state.runtime.current_section_id)) {
    const next = nextSectionAfter(blueprint, state.runtime.current_section_id);
    // Only advance when there is somewhere to go. On the last section this
    // leaves `allSectionsDone` to end the interview on the next check.
    if (next) enterSection(state, next.section_id);
  }
}

/**
 * Leaves the current section: anything still open is marked abandoned and the
 * section is recorded as done.
 *
 * A forced exit — the question budget spent, or the time ceiling reached — has
 * to close the section's goals explicitly. Leaving them `in_progress` means
 * `isSectionComplete` stays false forever, `sections_completed` never grows, and
 * `allSectionsDone` can never end the interview: it would run to the global time
 * ceiling every single time.
 */
function closeOutSection(state: LiveState, sectionId: string): void {
  for (const goal of state.coverage.goals) {
    if (goal.section_id !== sectionId) continue;
    if (goal.status === 'satisfied' || goal.status === 'abandoned') continue;
    goal.status = 'abandoned';
  }

  for (const section of state.coverage.section_status) {
    if (section.section_id === sectionId) section.complete = true;
  }

  if (!state.runtime.sections_completed.includes(sectionId)) {
    state.runtime.sections_completed.push(sectionId);
  }
}

/** Moves into a section and resets everything scoped to one. */
function enterSection(state: LiveState, sectionId: string): void {
  closeOutSection(state, state.runtime.current_section_id);

  state.runtime.current_section_id = sectionId;
  state.runtime.active_goal_id = null;
  state.runtime.turns_on_active_goal = 0;
  state.runtime.questions_in_section = 0;
  state.runtime.section_started_sec = state.runtime.elapsed_sec;
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




interface ResolvedQuestion {
  bankId?: string;
  rubric?: unknown;
  targetsEvidence: string[];
  gradingMode: QuestionRecord['grading_mode'];
  origin: QuestionRecord['origin'];
}

/**
 * Works out how the question the interviewer just wrote should be graded.
 *
 * ── The join that replaces the bank lookup ───────────────────────────────────
 * Nothing is looked up by id any more, because the interviewer wrote the
 * sentence. What is looked up is the EVIDENCE it says it was aiming at — and
 * that is what supplies both the rubric and the grading mode, so a question
 * invented thirty seconds ago is still graded against signals written before
 * the interview started (invariant 6) in a mode fixed at plan time
 * (invariant 9).
 *
 * A question claiming evidence that does not exist in its goal is not trusted
 * with the claim: `buildRubric` falls back to the goal's full evidence set
 * rather than producing an empty rubric, because an empty rubric is what makes
 * an answer ungradeable.
 */
function resolveGeneratedQuestion(args: {
  utterance: string;
  goal: BlueprintGoal | undefined;
  targetsEvidence: string[];
  sectionType?: BlueprintSection['type'];
  isTransition: boolean;
  seedBankId?: string;
}): ResolvedQuestion {
  /*
   * A handoff INTO the coding section is the utterance the submission gets
   * attached to, so it has to be graded as coding.
   *
   * This defaulted to experiential once, and the report never showed a coding
   * score: `aggregateSession` selects coding questions by `mode === 'coding'`,
   * found none, and left the dimension null — so the whole Judge0 round, and
   * the module fee paid for it, produced nothing.
   */
  if (args.isTransition) {
    return {
      targetsEvidence: [],
      gradingMode:
        args.sectionType === 'coding'
          ? 'coding'
          : args.sectionType === 'skill_challenge'
            ? 'skill'
            : 'experiential',
      origin: 'closing',
    };
  }

  if (!args.goal) {
    return { targetsEvidence: [], gradingMode: 'experiential', origin: 'generated' };
  }

  const known = new Set(args.goal.evidence_required.map((e) => e.evidence_id));
  const claimed = args.targetsEvidence.filter((id) => known.has(id));
  const effective = claimed.length > 0 ? claimed : args.goal.evidence_required.map((e) => e.evidence_id);

  /*
   * Grading mode comes from the evidence, and the strictest one wins.
   *
   * A question that touches both "describe what you built" and "explain what a
   * readiness probe is for" is answerable factually, and grading the whole
   * thing as experiential would mean a wrong explanation could never be marked
   * wrong. Experiential is the safer default in the other direction — it can
   * never mark an account of someone's own work as incorrect.
   */
  /*
   * In the behavioural section, the SECTION decides — not the evidence.
   *
   * `factual` outranks `behavioral` below, and that ordering is right
   * everywhere else: a question that touches both a claim and a mechanism must
   * be markable wrong on the mechanism. In the behavioural round it was the
   * bug. One evidence item tagged factual by P6 was enough to make every
   * question in the section grade factual, E4 never filled in the STAR fields
   * `scoreBehavioral` reads, `aggregateSession` averaged an empty set to null,
   * and `computeReadiness` rendered that null as a flat 0 on the report.
   *
   * P6 now writes `behavioral` on every evidence item in these sections and
   * `normaliseBlueprint` forces it — this is the third lock, at the point of
   * use, because the two upstream ones are on data that a resumed session may
   * have been checkpointed before.
   */
  if (args.sectionType === 'behavioral') {
    return {
      bankId: args.seedBankId,
      rubric: buildRubric(args.goal, effective),
      targetsEvidence: effective,
      gradingMode: 'behavioral',
      origin: args.seedBankId ? 'bank' : 'generated',
    };
  }

  const modes = new Set(
    args.goal.evidence_required.filter((e) => effective.includes(e.evidence_id)).map((e) => e.grading_mode),
  );
  const gradingMode: QuestionRecord['grading_mode'] = modes.has('coding')
    ? 'coding'
    : modes.has('skill')
      ? 'skill'
      : modes.has('factual')
        ? 'factual'
        : modes.has('behavioral')
          ? 'behavioral'
          : 'experiential';

  return {
    bankId: args.seedBankId,
    rubric: buildRubric(args.goal, effective),
    targetsEvidence: effective,
    gradingMode,
    origin: args.seedBankId ? 'bank' : 'generated',
  };
}

/**
 * The goal line shown beside a question, and stored with it.
 *
 * `activeGoal` is whatever the interviewer aimed at. On a handoff there is
 * often no goal — the utterance is a transition — so the section being entered
 * supplies its first goal instead, which is what the next question will pursue
 * anyway. Both cases beat showing nothing: a question with no visible purpose
 * is the thing that made the interview feel like a quiz.
 *
 * `pursuing` is deliberately narrowed to the evidence this question targets,
 * not the goal's whole list. The goal says where the conversation is going; this
 * says what THIS question is reaching for.
 */
function describeGoal(
  activeGoal: BlueprintGoal | undefined,
  targetSection: BlueprintSection | undefined,
  targetsEvidence: string[],
): NonNullable<TurnOutput['utterance']>['goal'] {
  const goal = activeGoal ?? targetSection?.goals[0];
  if (!goal) return null;

  const aimed = new Set(targetsEvidence);
  const pursuing = goal.evidence_required
    // When the question named no evidence — a transition, a clarification — the
    // goal's own required evidence is the honest answer to "what is this for".
    .filter((ev) => aimed.size === 0 || aimed.has(ev.evidence_id))
    .map((ev) => ev.description)
    .slice(0, 3);

  return { goal_id: goal.goal_id, statement: goal.statement, pursuing };
}

function applyRuntimeUpdates(
  state: LiveState,
  intent: ConversationalIntent,
  plan: UtterancePlan,
  resolved: ResolvedQuestion,
  nextSectionId: string | undefined,
): void {
  const rt = state.runtime;

  if (resolved.bankId) rt.asked_bank_ids.push(resolved.bankId);

  /*
   * R6's window records only ACKNOWLEDGEMENTS, and only pooled ones.
   *
   * The interviewer writes its own phrases now, so most of what lands here is
   * not from the pool. Recording those too would evict real entries from the
   * four-turn window and let a genuine repeat slip through, so the check stays:
   * the rule is about phrases that can repeat, and a sentence written fresh
   * each turn is not one of them.
   */
  if (plan.acknowledgement && ACKNOWLEDGEMENT_POOL.includes(plan.acknowledgement.trim())) {
    rt.recent_acknowledgements = [...rt.recent_acknowledgements, plan.acknowledgement.trim()].slice(-8);
  }
  // What KIND of question this was, so the interviewer can be told when it has
  // asked the same kind twice running.
  rt.recent_grading_modes = [...rt.recent_grading_modes, resolved.gradingMode].slice(-6);

  if (nextSectionId) {
    // This question belongs to the section being entered, so the new section's
    // budget starts at 1 rather than 0 — the transition utterance is the first
    // thing the candidate answers in it.
    closeOutSection(state, rt.current_section_id);
    rt.current_section_id = nextSectionId;
    rt.active_goal_id = null;
    rt.turns_on_active_goal = 0;
    rt.questions_in_section = 1;
    rt.section_started_sec = rt.elapsed_sec;
  } else {
    // Every question counts against the budget, whatever kind it was. Counting
    // only goal-directed ones would let a run of scaffolds and retries slip a
    // section past its ceiling for free.
    rt.questions_in_section += 1;

    if (intent.target_goal) {
      if (rt.active_goal_id === intent.target_goal) {
        rt.turns_on_active_goal += 1;
      } else {
        rt.active_goal_id = intent.target_goal;
        rt.turns_on_active_goal = 1;
      }
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
