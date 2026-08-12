/**
 * O1 · The live turn cycle — agentdesign.md §2.2, pipelined.
 *
 * ── The fast lane · `runTurn` · ZERO model calls ────────────────────────────
 *
 *   answer → L3 lexical ingest (<40ms) → §4 rules (~1ms) → top-ranked question
 *          → prepared audio                    ⟂ L3v, L2, L6 concurrent/off-path
 *
 * §2.2 originally put L1 and L4 inside this path, and the candidate paid for
 * both in silence after every answer: up to 1.2s deciding, 0.9s wording, then
 * speech synthesis, none of which could start until they stopped talking.
 *
 * Neither runs here now. The next question comes from the rule layer's own
 * ranking — which is not a downgrade, because §4 has already reduced the field
 * to what is legal, dropped questions whose evidence is verified (R11), varied
 * the question kind (R13), enforced the section budget (R12) and sorted by goal
 * priority. Choosing among those eight was L1's entire job.
 *
 * ── The slow lane · `reflectOnAnswer` · a separate request ──────────────────
 *
 * The adaptivity is deferred, not removed. `/reflect` runs L1 and L4 against the
 * answer WITH the transcript — which the live loop was never permitted to see
 * (§10 bars it from L1's prompt to stop context creep) — and queues a worded
 * follow-up for a turn or two later, prefaced so it reopens the topic by name.
 * The interviewer asks the next planned question immediately and comes back to
 * what you said a moment afterwards, which is also what a person does.
 *
 * It is a separate HTTP request rather than background work because there is no
 * job queue here, and work started after a response is flushed is not guaranteed
 * to survive on serverless compute.
 *
 * The orchestrator still makes NO interview decisions (invariant 1). Everything
 * below is sequencing, budget enforcement, and persistence. Where it looks like
 * it is deciding — picking the next section, ending the interview — it is
 * applying a ceiling the blueprint or the strategy already set.
 */

import type { Blueprint, ConversationalIntent, UtterancePlan } from '../agents/schemas';
import { runConversationManager } from '../agents/l1-conversation';
import { neutralPlan, runDialogueStyler } from '../agents/l4-styler';
import { runMemoryExtraction } from '../agents/l2-memory';
import { runCandidateQuestion } from '../agents/l6-candidate-question';
import {
  callbackNouns,
  markCallbackSpent,
  mergeExtraction,
  openCallbacks,
  type InterviewMemory,
} from '../engine/l2-memory-store';
import {
  applyEvidenceVerdicts,
  checkGoalExit,
  ingestAnswer,
  isSectionComplete,
} from '../engine/l3-evidence';
import { runEvidenceCheck } from '../agents/l3-verify';
import {
  ACKNOWLEDGEMENT_POOL,
  legalActions,
  pickAcknowledgement,
  validateAndRepairPlan,
  validateIntent,
  type RuleInput,
} from '../engine/rules';
import {
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

/**
 * A dig-deeper question produced by `/reflect` from an earlier answer.
 *
 * Carries its own preface because by the time it is asked, one or two other
 * questions have been asked in between — so it has to reopen the topic
 * explicitly ("Coming back to the ingestion pipeline you mentioned —") or the
 * candidate answers it at the wrong scope.
 */
export interface PendingFollowup {
  v: 2;
  /** The full spoken line, preface included. Already worded by L4. */
  question: string;
  /** Which answer prompted it, for the transcript record. */
  fromQuestionId: string;
  goalId: string | null;
  targetsEvidence: string[];
  gradingMode: QuestionRecord['grading_mode'];
  /** Turn at which it was produced. Used to expire it if it goes stale. */
  createdAtTurn: number;
  /** L1's difficulty judgement, applied when this is asked. */
  difficultyDelta: number;
  emotionalTone: string;
}

/**
 * How many turns a deferred follow-up may wait before it is dropped.
 *
 * Two is the point of the design — ask it after the next question, or the one
 * after if that one was itself deferred. Beyond that the candidate has moved on
 * twice and reopening reads as the interviewer losing the thread rather than
 * keeping it.
 */
const FOLLOWUP_MAX_AGE_TURNS = 2;

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
  /**
   * Material for answering a question the CANDIDATE asks (L6).
   *
   * Supplied by the route only when the last answer looks like a question, so an
   * ordinary turn pays neither the database read nor the model call.
   */
  employer?: {
    roleTitle: string;
    companyName: string;
    jdContext?: string;
    companyContext?: string;
  };
  /** A follow-up `/reflect` prepared from an earlier answer, if one is waiting. */
  pendingFollowup?: PendingFollowup | null;
}

/**
 * Does the last answer contain a question aimed at the interviewer?
 *
 * A deterministic gate in front of a model call, and the reason answering the
 * candidate costs nothing on the other twenty-four turns. Two ways in: the
 * interviewer explicitly invited questions, or the candidate's own words are
 * shaped like one.
 *
 * Exported because the route uses the same test to decide whether to load the
 * employer material at all.
 */
export function looksLikeCandidateQuestion(transcript: string, askedQuestion: string): boolean {
  const asked = askedQuestion.toLowerCase();
  const invited =
    /\b(any questions|questions for me|anything you'?d like to ask|anything you want to know|anything else you)\b/.test(
      asked,
    );

  const said = transcript.toLowerCase();
  // An invitation counts even without a question mark — "yeah, what does the
  // team look like" is a question however the transcriber punctuated it.
  const interrogative =
    /\b(what|how|why|when|where|who|which|is there|are there|do you|does the|could you|can you|would i|will i|what'?s)\b/.test(
      said,
    );

  if (invited) return interrogative || said.includes('?');
  return said.includes('?') && interrogative;
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

  /*
   * L6 · did they ask US something? Launched alongside L1 for the same reason.
   *
   * The interviewer used to take "so what does the release process look like?"
   * as an answer, grade it against a rubric, and ask the next question — which
   * is the single rudest thing the system did. Now it gets answered before the
   * interview continues.
   */
  const answeringCandidate =
    input.answer && lastQuestion && input.employer &&
    looksLikeCandidateQuestion(input.answer.transcript, lastQuestion.text)
      ? runCandidateQuestion(
          {
            transcript: input.answer.transcript,
            askedQuestion: lastQuestion.text,
            roleTitle: input.employer.roleTitle,
            companyName: input.employer.companyName,
            jdContext: input.employer.jdContext,
            companyContext: input.employer.companyContext,
          },
          context,
        ).catch(() => null)
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
   * ── 4 · Choosing the next question, WITHOUT a model call ─────────────────
   *
   * This is the pipelining change, and it is the whole latency story.
   *
   * The turn used to run L1 (≤1.2s) then L4 (≤0.9s) then synthesize speech,
   * serially, while the candidate sat listening to nothing. None of that could
   * begin until they stopped talking, so the floor on "silence after your
   * answer" was the sum of all of it.
   *
   * It no longer runs either. Two sources supply the next question:
   *
   *   1. A follow-up `/reflect` prepared from an EARLIER answer, already worded
   *      and already carrying its own preface.
   *   2. Otherwise the rule layer's top-ranked legal action — which is not a
   *      degraded choice. §4 has already filtered to what is legal, dropped
   *      questions whose evidence is verified (R11), varied the question kind
   *      (R13), enforced the section budget (R12) and ranked by goal priority.
   *      L1's contribution was picking among those eight; the ranking already
   *      encodes most of that judgement.
   *
   * The adaptivity L1 provided is not lost, it is DEFERRED — and it comes back
   * better informed, because `/reflect` reads the actual transcript, which L1
   * was never allowed to see (§10 bars it from the live prompt). The interviewer
   * asks the next planned question immediately and returns to what you said a
   * moment later, which is also what a person does.
   */
  const followup = usablePendingFollowup(input.pendingFollowup, state.runtime.turn);

  let intent: ConversationalIntent;
  let intentRejected: string | undefined;

  if (followup) {
    intent = intentFromFollowup(followup);
  } else {
    intent = intentFromAction(shortlist[0], neutralIntent(answerWeak));

    // The same post-validation the model's choice used to face. The rule layer's
    // own top pick is legal by construction, so this only ever fires if the two
    // disagree about difficulty bounds — but it is cheap and it keeps §4 as the
    // single authority on what is permitted.
    const validation = validateIntent(intent, shortlist, ruleInput);
    if (!validation.valid) {
      intentRejected = validation.reason;
      intent = { ...intent, difficulty_delta: 0 };
    }
  }

  if (intent.action === 'CLOSE_INTERVIEW') {
    await collectVerdicts();
    state.runtime.finished = true;
    return finish(state, newlyVerified);
  }

  // ── 6 · Resolve what will actually be said ───────────────────────────────
  const chosen = matchAction(shortlist, intent);
  const resolved = resolveQuestionText(
    blueprint,
    intent,
    chosen,
    // The section being ENTERED when this is a transition, otherwise the one we
    // are already in.
    (intent.action === 'TRANSITION_SECTION'
      ? nextSectionAfter(blueprint, state.runtime.current_section_id)?.type
      : section?.type),
  );

  const callbackItem =
    intent.action === 'CALLBACK' && intent.callback_memory_id
      ? state.memory.items.find((i) => i.item_id === intent.callback_memory_id)
      : undefined;

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
   * ── 7 · Wording it, also without a model call ────────────────────────────
   *
   * `neutralPlan` is L4's own fallback and has always been the shape L4
   * produces — an acknowledgement from the R5 pool, a transition the blueprint
   * author wrote, and the bank question verbatim. L4 never rewrites a bank
   * question anyway (`enforceVerbatimQuestion`), so on the overwhelmingly common
   * path the model was choosing between eight fixed acknowledgement phrases at a
   * cost of up to 900ms.
   *
   * Where genuinely new words are needed — a dig-deeper probe grounded in what
   * the candidate said — L4 still writes them. It does it in `/reflect`, off the
   * critical path, with the transcript in front of it.
   */
  const followupPlan = followup ? { utterance: followup.question } : undefined;

  const l4 = {
    plan: {
      ...neutralPlan({
        intent,
        questionText: followupPlan?.utterance ?? resolved.text,
        exitTransition: section?.exit_transitions[0],
        entryTransition: nextSection?.entry_transitions[0],
        callbackNouns: callbackItem ? callbackNouns(callbackItem) : undefined,
        persona: input.persona,
        runtime: state.runtime,
        isFirstQuestion: state.questions.length === 0,
        missingEvidence: missingEvidenceDescriptions(blueprint, state, intent),
      }),
      // A deferred follow-up carries its own preface, so a second transition in
      // front of it would say the same thing twice.
      ...(followup ? { transition: '' } : {}),
    },
    fromFallback: false,
    latencyMs: 0,
  };

  const { plan, repairs } = validateAndRepairPlan(l4.plan, state.runtime, {
    callbackNouns: callbackItem ? callbackNouns(callbackItem) : undefined,
  });

  /*
   * Their question gets answered FIRST, in place of the acknowledgement.
   *
   * It goes in the acknowledgement slot rather than in front of the transition
   * because that is what it is — the receipt for what they just said. Replacing
   * it also stops the interviewer saying "Got it." to a question and then
   * answering it, which reads as a machine executing two unrelated steps.
   */
  const candidateAnswer = answeringCandidate ? await answeringCandidate : null;

  if (candidateAnswer?.is_question && candidateAnswer.answer.trim()) {
    plan.acknowledgement = candidateAnswer.answer.trim();
    // R6 bans reusing an acknowledgement within four turns, and this is not a
    // phrase from the pool — keeping it out of the history stops it evicting
    // three real acknowledgements from the window.
    plan.allow_barge_in_after_ms = Math.max(plan.allow_barge_in_after_ms, 1_500);
  }

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

  // Both blocking calls are done; the verifier has had their combined budget to
  // land. Merging here puts its verdicts in coverage before the next turn's
  // shortlist is built, which is the whole point of running it early.
  await collectVerdicts();

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
      // Both zero by design now: the turn makes no model call. Latency lives in
      // /reflect, which is off this path entirely.
      l1LatencyMs: 0,
      l4LatencyMs: l4.latencyMs,
      l1Fallback: false,
      l4Fallback: l4.fromFallback,
      ruleRepairs: repairs,
      intentRejected,
      newlyVerified,
    },
  };
}

/**
 * The slow lane · reads the answer properly and decides whether it is worth
 * coming back to.
 *
 * Runs in its OWN request, fired by the client the moment the turn resolves and
 * completing while the interviewer speaks the next question. That placement is
 * not an optimisation detail — there is no job queue here, and work started
 * inside a route handler after the response is sent is not guaranteed to finish
 * on serverless compute. A separate request has its own lifetime, so this is the
 * one arrangement that reliably completes.
 *
 * It gets what the live loop never could: the transcript. L1 is barred from
 * seeing it (§10, context creep) because it runs inside the turn budget — this
 * does not, so the probe it produces is grounded in the candidate's own words
 * instead of in a word count.
 */
export async function reflectOnAnswer(input: {
  sessionId: string;
  userId: string;
  projectId: string;
  blueprint: Blueprint;
  state: LiveState;
  persona: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  answer: { transcript: string; wordCount: number; durationSec: number };
  /** The question that answer was given to. */
  questionId: string;
}): Promise<PendingFollowup | null> {
  const context = {
    userId: input.userId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  };

  const state = input.state;
  const blueprint = input.blueprint;
  const question = state.questions.find((q) => q.question_id === input.questionId);
  if (!question) return null;

  const goal = question.goal_id
    ? state.coverage.goals.find((g) => g.goal_id === question.goal_id)
    : undefined;

  // Nothing left to establish on this goal means nothing to dig into. The next
  // planned question is the right move and no follow-up is produced.
  if (!goal || goal.outstanding.length === 0) return null;
  if (goal.status === 'satisfied' || goal.status === 'abandoned') return null;

  const ruleInput: RuleInput = {
    blueprint,
    coverage: state.coverage,
    runtime: state.runtime,
    memory: openCallbacks(state.memory, 3),
    lastQuestion: {
      skill_tags: question.skill_tags,
      entry_style: undefined,
      text: question.text,
    },
    lastAnswerSec: input.answer.durationSec,
    sectionElapsedSec: Math.max(0, state.runtime.elapsed_sec - state.runtime.section_started_sec),
    difficulty: input.difficulty,
  };

  const shortlist = legalActions(ruleInput);
  const section = blueprint.sections.find((s) => s.section_id === state.runtime.current_section_id);

  const l1 = await runConversationManager(
    {
      shortlist,
      coverage: state.coverage,
      runtime: state.runtime,
      callbacks: openCallbacks(state.memory, 3),
      sectionTitle: section?.title ?? 'Interview',
      goalStatements: goalStatements(blueprint),
      sectionBudget: {
        asked: state.runtime.questions_in_section,
        ...SECTION_QUESTION_BUDGET[input.difficulty ?? 'medium'],
      },
      lastAnswerSignal: {
        wordCount: input.answer.wordCount,
        durationSec: input.answer.durationSec,
        newEvidenceCount: 0,
        disclaimed: false,
        weak: false,
      },
    },
    context,
  ).catch(() => null);

  // Only a probe is worth deferring. A decision to move on is already what the
  // fast lane does by default, and a section change is R12's call, not L1's.
  if (!l1 || l1.intent.action !== 'PROBE_EVIDENCE') return null;

  const missing = missingEvidenceDescriptions(blueprint, state, l1.intent);
  if (!missing || missing.length === 0) return null;

  const l4 = await runDialogueStyler(
    {
      intent: l1.intent,
      // Deliberately no questionText: this is the one place a genuinely new
      // question is wanted, written against what they actually said.
      exitTransition: undefined,
      entryTransition: undefined,
      persona: input.persona,
      runtime: state.runtime,
      lastAnswer: input.answer.transcript,
      missingEvidence: missing,
      deferred: { originalQuestion: question.text },
    },
    context,
  ).catch(() => null);

  const text = l4?.plan.utterance?.trim();
  if (!text) return null;

  return {
    v: 2,
    question: text,
    fromQuestionId: question.question_id,
    goalId: question.goal_id ?? null,
    targetsEvidence: l1.intent.missing_evidence.slice(0, 4),
    // A probe into their own account is experiential however the original was
    // graded — it cannot be marked wrong.
    gradingMode: question.grading_mode === 'factual' ? 'factual' : 'experiential',
    createdAtTurn: state.runtime.turn,
    difficultyDelta: l1.intent.difficulty_delta,
    emotionalTone: l1.intent.emotional_tone,
  };
}

/** Drops a follow-up that has waited too long to still make sense. */
function usablePendingFollowup(
  pending: PendingFollowup | null | undefined,
  turn: number,
): PendingFollowup | null {
  if (!pending?.question?.trim()) return null;
  return turn - pending.createdAtTurn <= FOLLOWUP_MAX_AGE_TURNS ? pending : null;
}

function neutralIntent(weak: boolean): ConversationalIntent {
  return {
    action: 'PROBE_EVIDENCE',
    target_goal: null,
    target_skill: null,
    missing_evidence: [],
    source_kind: 'none',
    source_id: null,
    transition_type: 'none',
    emotional_tone: weak ? 'encouraging' : 'neutral',
    callback_memory_id: null,
    response_strategy: weak ? 'scaffold' : 'direct',
    difficulty_delta: 0,
    acknowledge_answer: true,
    reason: 'Rule-layer top-ranked action (pipelined turn — no live model call).',
    confidence: 0.6,
  };
}

function intentFromFollowup(followup: PendingFollowup): ConversationalIntent {
  return {
    action: 'PROBE_EVIDENCE',
    target_goal: followup.goalId,
    target_skill: null,
    missing_evidence: followup.targetsEvidence,
    source_kind: 'generated',
    source_id: null,
    transition_type: 'none',
    emotional_tone: (followup.emotionalTone as ConversationalIntent['emotional_tone']) ?? 'neutral',
    callback_memory_id: null,
    response_strategy: 'direct',
    difficulty_delta: followup.difficultyDelta,
    acknowledge_answer: true,
    reason: `Deferred probe from ${followup.fromQuestionId}.`,
    confidence: 0.8,
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

/**
 * What the interviewer still needs from the active goal, in the words the
 * blueprint author wrote. Handed to L4 so a generated probe aims at something
 * real instead of nudging.
 */
function missingEvidenceDescriptions(
  blueprint: Blueprint,
  state: LiveState,
  intent: ConversationalIntent,
): string[] | undefined {
  const goalId = intent.target_goal ?? state.runtime.active_goal_id;
  if (!goalId) return undefined;

  const bpGoal = findBlueprintGoal(blueprint, goalId);
  const goalState = state.coverage.goals.find((g) => g.goal_id === goalId);
  if (!bpGoal || !goalState) return undefined;

  // The intent's own targets first when it named any — that is what L1 decided
  // to chase — falling back to whatever the goal still has open.
  const wanted = intent.missing_evidence.length ? intent.missing_evidence : goalState.outstanding;

  return wanted
    .map((id) => bpGoal.evidence_required.find((e) => e.evidence_id === id)?.description)
    .filter((d): d is string => Boolean(d))
    .slice(0, 3);
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
  sectionType?: Blueprint['sections'][number]['type'],
): ResolvedQuestion {
  if (intent.action === 'TRANSITION_SECTION') {
    /*
     * A transition INTO the coding section is the question the submission gets
     * attached to, so it has to be graded as coding.
     *
     * It defaulted to experiential, which is why the report never showed a
     * coding score: `aggregateSession` selects coding questions by
     * `mode === 'coding'`, found none, and left the dimension null — so the
     * whole Judge0 round, and the module fee paid for it, produced nothing on
     * the report.
     */
    return {
      gradingMode: sectionType === 'coding' ? 'coding' : 'experiential',
      origin: 'closing',
    };
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

  // Only pooled acknowledgements enter the R6 history. An answer to the
  // candidate's own question occupies the same slot but is not a phrase that can
  // repeat, and recording it would evict real entries from the four-turn window.
  if (plan.acknowledgement && ACKNOWLEDGEMENT_POOL.includes(plan.acknowledgement.trim())) {
    rt.recent_acknowledgements = [...rt.recent_acknowledgements, plan.acknowledgement.trim()].slice(-8);
  }
  if (chosen?.skill_tags.length) {
    rt.recent_skill_tags = [...rt.recent_skill_tags, ...chosen.skill_tags].slice(-8);
  }
  if (resolved.entryStyle) {
    rt.recent_entry_styles = [...rt.recent_entry_styles, resolved.entryStyle].slice(-4);
  }
  // R13's input: what KIND of question this was, so the next turn can prefer a
  // different one and the mix of skill-check / resume / behavioural actually
  // reaches the candidate instead of only existing in the blueprint.
  rt.recent_grading_modes = [...rt.recent_grading_modes, resolved.gradingMode].slice(-6);

  if (intent.action === 'CALLBACK') rt.last_callback_turn = rt.turn;
  if (intent.action === 'CORRECT_AND_CONTINUE') rt.corrections_used += 1;

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
