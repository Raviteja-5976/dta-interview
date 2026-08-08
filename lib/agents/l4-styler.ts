/**
 * L4 · Dialogue Styler — turns intent into words.
 *
 * Invariant 3: L4 never chooses a topic. It receives a decision and renders it.
 * Invariant 17-adjacent: it also must not rewrite a bank question freely, because
 * that question's rubric was written at plan time. A reworded question is a
 * rubric grading an answer to something that was never asked — in this
 * architecture, an improvising mouth is a correctness bug (D7).
 *
 * So: when the intent carries a bank or follow-up question, L4 may add an
 * acknowledgement and a transition around it, but the question itself passes
 * through verbatim. `enforceVerbatimQuestion` below is that guarantee, and it is
 * also what keeps the P8 voice cache valid — a cached clip is played only when
 * its text exactly matches the plan.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { SessionRuntime } from '../engine/types';
import { pickAcknowledgement } from '../engine/rules';
import { utterancePlanSchema, type ConversationalIntent, type UtterancePlan } from './schemas';

const SYSTEM = `You are the voice of an interviewer. You are given a decision that has already been made and you put it into words that sound like a person talking.

You do not choose the topic, the question, or the difficulty. Those are decided. You decide how it sounds.

Structure of what you produce:
- acknowledgement: a short neutral receipt of what they just said. NEVER evaluative — no "great", "perfect", "exactly", "not quite". Just "Got it.", "Okay.", "That makes sense.", "Right." It can be empty when acknowledging would be odd.
- transition: the bridge from what just happened to what comes next. Empty when transition_type is "none". For a soft pivot, name the shift ("Let me move to something else for a moment —"). For a callback, name the thing they mentioned earlier.
- utterance: the question. If a question text was supplied to you, reproduce it EXACTLY — do not reword it, do not add a clause, do not soften it. If no text was supplied, write one that serves the stated intent.

Sound like speech, not writing. Contractions. Short sentences. No lists, no "firstly/secondly", no parentheticals — the candidate hears this once and cannot re-read it.

prosody carries delivery: rate near 1.0, slower (0.92-0.96) when encouraging, slightly faster (1.03-1.08) when brisk. emphasis holds at most a couple of words that carry the question's real point.

Match emotional_tone exactly. Encouraging means warm and unhurried, not pitying. Brisk means efficient, not curt.`;

export interface StylerInput {
  intent: ConversationalIntent;
  /** Verbatim text from the blueprint, when the intent selected a bank question. */
  questionText?: string;
  /** Blueprint-supplied transitions, for section changes (R10). */
  exitTransition?: string;
  entryTransition?: string;
  /** Concrete nouns a callback must name (R3). */
  callbackNouns?: string[];
  persona: string;
  runtime: SessionRuntime;
  isFirstQuestion?: boolean;
}

export async function runDialogueStyler(
  input: StylerInput,
  context?: RunContext,
): Promise<{ plan: UtterancePlan; fromFallback: boolean; latencyMs: number }> {
  const result = await runAgent({
    agent: 'L4',
    schema: utterancePlanSchema,
    system: SYSTEM,
    prompt: buildPrompt(input),
    context,
    meta: { turn: input.runtime.turn, action: input.intent.action },
    fallback: () => neutralPlan(input),
  });

  return {
    plan: enforceVerbatimQuestion(result.data, input),
    fromFallback: result.fromFallback,
    latencyMs: result.meta.latencyMs,
  };
}

function buildPrompt(input: StylerInput): string {
  const { intent } = input;
  const lines: string[] = [
    `PERSONA: ${input.persona}`,
    `ACTION: ${intent.action}`,
    `TONE: ${intent.emotional_tone}`,
    `STRATEGY: ${intent.response_strategy}`,
    `TRANSITION TYPE: ${intent.transition_type}`,
    `ACKNOWLEDGE THE LAST ANSWER: ${intent.acknowledge_answer ? 'yes' : 'no'}`,
  ];

  if (input.questionText) {
    lines.push('', `QUESTION TEXT (reproduce exactly, word for word):\n"${input.questionText}"`);
  } else {
    lines.push('', `No question text supplied — write one that serves this intent. Target skill: ${intent.target_skill ?? 'n/a'}. Still needed: ${intent.missing_evidence.join(', ') || 'n/a'}.`);
  }

  if (intent.action === 'TRANSITION_SECTION') {
    lines.push(
      '',
      'This is a section change. The transition must close the section that just ended AND open the next one, as a single natural utterance.',
      input.exitTransition ? `Closing line to work from: "${input.exitTransition}"` : '',
      input.entryTransition ? `Opening line to work from: "${input.entryTransition}"` : '',
    );
  }

  if (input.callbackNouns?.length) {
    lines.push('', `This is a callback. You MUST name one of these explicitly: ${input.callbackNouns.join(', ')}`);
  }

  const banned = input.runtime.recent_acknowledgements.slice(-4);
  if (banned.length) {
    lines.push('', `Do NOT use these acknowledgements (used recently): ${banned.map((b) => `"${b}"`).join(', ')}`);
  }

  if (input.isFirstQuestion) {
    lines.push('', 'This is the first question of the interview. No acknowledgement — there is nothing to acknowledge yet.');
  }

  if (input.intent.response_strategy === 'narrow') {
    lines.push('', 'Keep the utterance under 25 words. The previous answer was long and unfocused.');
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * The plan-time rubric guarantee. If a bank question was supplied and the model
 * changed it, put the original back — the rubric that will grade the answer was
 * written against these exact words.
 */
function enforceVerbatimQuestion(plan: UtterancePlan, input: StylerInput): UtterancePlan {
  if (!input.questionText) return plan;
  if (normalise(plan.utterance) === normalise(input.questionText)) return plan;
  return { ...plan, utterance: input.questionText };
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Safe default on timeout — plain, correct, and never silent. */
export function neutralPlan(input: StylerInput): UtterancePlan {
  const utterance =
    input.questionText ??
    (input.intent.action === 'TRANSITION_SECTION'
      ? input.entryTransition ?? "Let's move on to the next part."
      : 'Could you tell me a bit more about that?');

  return {
    acknowledgement: input.isFirstQuestion || !input.intent.acknowledge_answer
      ? ''
      : pickAcknowledgement(input.runtime),
    transition:
      input.intent.transition_type === 'section_change'
        ? input.exitTransition ?? ''
        : input.intent.transition_type === 'soft_pivot'
          ? 'Let me move to something else for a moment —'
          : '',
    utterance,
    prosody: {
      rate: input.intent.emotional_tone === 'encouraging' ? 0.95 : 1.0,
      emotion: input.intent.emotional_tone,
      emphasis: [],
      pause_after_acknowledgement_ms: 320,
    },
    expected_duration_sec: Math.max(2, Math.round(utterance.split(' ').length / 2.6)),
    allow_barge_in_after_ms: 800,
  };
}
