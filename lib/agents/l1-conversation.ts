/**
 * L1 · Conversation Manager — the interviewer's judgement.
 *
 * Reads evidence gaps, memory, and conversational rhythm; emits structured
 * intent. Never emits prose (invariant 2) — L4 does the words.
 *
 * ── Two constraints that are enforced here, in code ──────────────────────────
 * 1. The input is FIXED-SHAPE and never contains the transcript. agentdesign.md
 *    §10 names context creep in L1 as the thing that kills live agents by turn
 *    twenty, and says to enforce it in code rather than in the prompt. The
 *    `buildPrompt` function below is the enforcement: there is no parameter it
 *    could accept that would let a transcript in.
 * 2. It chooses from a shortlist the §4 rule layer has already filtered, so it
 *    cannot select an illegal action. At most 8 options, which keeps the prompt
 *    near-constant in size however deep into the interview we are.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { CandidateAction, Coverage, SessionRuntime } from '../engine/types';
import type { MemoryItem } from '../engine/l2-memory-store';
import { conversationalIntentSchema, type ConversationalIntent } from './schemas';

const SYSTEM = `You are the judgement of an interviewer, mid-conversation. You decide WHAT to do next and WHY. You never write the sentence — a separate component words it.

You are given a shortlist of legal actions. Every option has already been checked against the conversation rules, so anything on the list is permitted and anything absent is not. Choose exactly one.

How to choose:
- Prefer the action that closes the largest gap in what you still need to establish. The outstanding evidence list is the most important input you have.
- Prefer a follow-up when the candidate landed on the topic but missed the specific thing you need. Prefer a new question when they have given you all this angle will yield.
- Choose CALLBACK when a memory item connects naturally to what you are currently investigating. Not to show off recall.
- Choose CLOSE_GOAL when further probing will not produce evidence — either it is established, or the candidate has shown they cannot supply it.
- Choose TRANSITION_SECTION when the section's goals are done or its time is spent.

emotional_tone reads the candidate, not the topic. Someone who just gave a confident, detailed answer gets "neutral" or "brisk". Someone who hesitated, hedged, or fell short gets "encouraging". Do not be warm by default — constant warmth reads as insincere.

response_strategy:
- scaffold      — break the question into a smaller first step (use after a weak answer)
- narrow        — ask for one specific thing (use after a long, unfocused answer)
- broaden       — open it up (use when they gave a terse answer to an open question)
- concrete_example — ask for a specific instance instead of a generalisation
- rephrase      — same question, different words (use when they misread it)
- direct        — just ask

difficulty_delta is -1, 0 or +1 only. Raise it only when the last answer was complete and confident. Lower it only when they are struggling.

reason is one short sentence stating what you still need and why this action gets it. It is read by engineers debugging the interview, not by the candidate.`;

export interface ConversationManagerInput {
  shortlist: CandidateAction[];
  coverage: Coverage;
  runtime: SessionRuntime;
  callbacks: MemoryItem[];
  sectionTitle: string;
  goalStatements: Record<string, string>;
  /** A short, bounded characterisation of the last answer. NOT the transcript. */
  lastAnswerSignal: {
    wordCount: number;
    durationSec: number;
    newEvidenceCount: number;
    disclaimed: boolean;
    weak: boolean;
  };
}

/**
 * Builds L1's prompt. This function's signature is the enforcement mechanism for
 * constraint 1 above — it accepts no transcript, so none can be passed.
 */
function buildPrompt(input: ConversationManagerInput): string {
  const activeGoal = input.runtime.active_goal_id;
  const goalState = input.coverage.goals.find((g) => g.goal_id === activeGoal);

  const gaps = goalState
    ? goalState.outstanding.join(', ') || '(none — this goal is complete)'
    : '(no active goal)';

  const options = input.shortlist
    .map((c, i) => {
      const parts = [
        `${i + 1}. action=${c.action}`,
        c.goal_id ? `goal=${c.goal_id}` : null,
        c.source_kind !== 'none' ? `source=${c.source_kind}:${c.source_id}` : null,
        c.targets_evidence.length ? `targets=[${c.targets_evidence.join(', ')}]` : null,
        c.entry_style ? `style=${c.entry_style}` : null,
        c.difficulty !== undefined ? `difficulty=${c.difficulty}` : null,
        c.text ? `text="${c.text}"` : null,
      ].filter(Boolean);
      return parts.join(' · ');
    })
    .join('\n');

  const callbacks = input.callbacks.length
    ? input.callbacks
        .map((m) => `- ${m.item_id}: ${m.label} (${m.kind}, importance ${m.importance})`)
        .join('\n')
    : '(none available)';

  const a = input.lastAnswerSignal;

  return [
    `SECTION: ${input.sectionTitle}`,
    `ACTIVE GOAL: ${activeGoal ? input.goalStatements[activeGoal] ?? activeGoal : '(none)'}`,
    `STILL MISSING: ${gaps}`,
    '',
    `LAST ANSWER: ${a.wordCount} words over ${Math.round(a.durationSec)}s · ${a.newEvidenceCount} new evidence item(s)${a.disclaimed ? ' · candidate disclaimed knowledge' : ''}${a.weak ? ' · weak' : ''}`,
    `RHYTHM: turn ${input.runtime.turn} · ${input.runtime.turns_on_active_goal} turns on this goal · ${input.runtime.consecutive_weak_answers} consecutive weak · difficulty ${input.runtime.current_difficulty} · corrections used ${input.runtime.corrections_used}/2`,
    '',
    'MEMORY AVAILABLE FOR CALLBACK:',
    callbacks,
    '',
    'LEGAL ACTIONS (choose exactly one):',
    options,
    '',
    'Emit the conversational intent. Set source_kind and source_id to match the option you chose.',
  ].join('\n');
}

export async function runConversationManager(
  input: ConversationManagerInput,
  context?: RunContext,
): Promise<{ intent: ConversationalIntent; fromFallback: boolean; latencyMs: number }> {
  const result = await runAgent({
    agent: 'L1',
    schema: conversationalIntentSchema,
    system: SYSTEM,
    prompt: buildPrompt(input),
    context,
    meta: { turn: input.runtime.turn, options: input.shortlist.length },
    // Hard timeout at 550ms with a safe default. A slightly less adaptive turn
    // always beats a stalling one (§10, technique 3).
    fallback: () => fallbackIntent(input),
  });

  return {
    intent: result.data,
    fromFallback: result.fromFallback,
    latencyMs: result.meta.latencyMs,
  };
}

/**
 * The safe default. Takes the rule layer's own top-ranked option, which is
 * already legal and already sorted by priority — so a timeout costs adaptivity,
 * not correctness.
 */
export function fallbackIntent(input: ConversationManagerInput): ConversationalIntent {
  const top = input.shortlist[0];

  return {
    action: top?.action ?? 'TRANSITION_SECTION',
    // `null` rather than `undefined` throughout: the schema is nullable, not
    // optional, because OpenAI strict mode has no concept of an absent key.
    target_goal: top?.goal_id ?? null,
    target_skill: top?.skill_tags[0] ?? null,
    missing_evidence: top?.targets_evidence.slice(0, 4) ?? [],
    source_kind: top?.source_kind ?? 'none',
    source_id: top?.source_id ?? null,
    transition_type: top?.action === 'TRANSITION_SECTION' ? 'section_change' : 'none',
    emotional_tone: input.lastAnswerSignal.weak ? 'encouraging' : 'neutral',
    callback_memory_id: top?.action === 'CALLBACK' ? (top.source_id ?? null) : null,
    response_strategy: input.lastAnswerSignal.weak ? 'scaffold' : 'direct',
    difficulty_delta: 0,
    acknowledge_answer: true,
    reason: 'Fallback: rule-layer top-ranked action (L1 unavailable).',
    confidence: 0.4,
  };
}
