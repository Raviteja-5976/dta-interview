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
  /**
   * The answer just given, and what the interviewer still needs from it.
   *
   * Supplied ONLY when no bank text exists and L4 has to write the question
   * itself. This is the narrowest possible breach of "L4 never sees the
   * transcript", and it is the difference between a probe that digs and one that
   * says "could you tell me a bit more about that?" — a follow-up cannot be
   * specific to an answer it has not read.
   *
   * Bounded on purpose: last answer only, truncated. §10 names unbounded context
   * growth in the live agents as the thing that kills them by turn twenty, and
   * this stays constant-size however deep the interview runs.
   */
  lastAnswer?: string;
  /** Human descriptions of the evidence still missing, for a targeted probe. */
  missingEvidence?: string[];
  /**
   * Set when this question will be asked one or two turns from now, after
   * something else has been discussed.
   *
   * It changes what the sentence has to do: the topic is no longer in the air,
   * so the question has to reopen it by name before asking anything.
   */
  deferred?: { originalQuestion: string };
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
    /*
     * The generative branch. Everything below exists so this produces a probe
     * into what they actually said, rather than a generic nudge — the follow-up
     * has to quote their own material back at them to be worth asking.
     */
    lines.push(
      '',
      'No question text supplied — YOU write the question.',
      `Target skill: ${intent.target_skill ?? 'n/a'}.`,
    );

    if (input.missingEvidence?.length) {
      lines.push(
        'It must extract ONE of these specifically:',
        ...input.missingEvidence.map((e) => `  - ${e}`),
      );
    }

    if (input.lastAnswer) {
      lines.push(
        '',
        `<their last answer>\n${truncate(input.lastAnswer, 900)}\n</their last answer>`,
        '',
        'Build the question out of THEIR material. Name the specific system, number, tool or decision they mentioned and ask for the layer underneath it — the mechanism, the trade-off, the measurement, or the thing that went wrong.',
        'Forbidden: "tell me more about that", "can you elaborate", "go deeper on that", or any question that would make sense after a different answer. If it does not name something they said, it is the wrong question.',
      );
    }

    if (input.deferred) {
      lines.push(
        '',
        'IMPORTANT — this will not be asked next. One or two other questions come first, so by the time they hear it the topic has moved on.',
        `They were originally answering: "${input.deferred.originalQuestion}"`,
        'So OPEN by reopening the topic by name, then ask. Put both in the `utterance` as one natural line, and leave `transition` empty.',
        '  "Coming back to the ingestion pipeline for a second — how did you decide on the chunk size?"',
        '  "Actually, one more on Hyrzo — what did you measure to know retrieval had improved?"',
        'A bare question here lands with no subject and gets answered at the wrong scope.',
      );
    }
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

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/**
 * Safe default on timeout — plain, correct, and never silent.
 *
 * The fallback probe is built from the missing evidence rather than being a
 * fixed string. "Could you tell me a bit more about that?" was what a candidate
 * heard after most questions, because L4 timing out and the rule layer picking a
 * text-less action both land here — and a generic nudge teaches the candidate
 * that the interviewer is not listening. Naming the thing we still need is no
 * harder to produce and is an actual question.
 */
export function neutralPlan(input: StylerInput): UtterancePlan {
  const utterance =
    input.questionText ??
    (input.intent.action === 'TRANSITION_SECTION'
      ? input.entryTransition ?? "Let's move on to the next part."
      : fallbackProbe(input));

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

/**
 * A concrete probe with no model call, built from what the tracker says is still
 * missing. Not as good as a question grounded in their answer — but it names a
 * real thing, which is the bar a follow-up has to clear.
 */
function fallbackProbe(input: StylerInput): string {
  const want = input.missingEvidence?.[0]?.trim();
  if (!want) {
    return input.intent.response_strategy === 'scaffold'
      ? 'Take it from the start — what was the first thing you actually did?'
      : 'Walk me through how you did that, step by step.';
  }

  // Descriptions are written as third-person statements of what the candidate
  // should supply ("Names the evaluation metric they used"), so they read
  // naturally after "walk me through" once the leading verb is lowercased.
  const phrased = want.charAt(0).toLowerCase() + want.slice(1);
  return `Staying on that — ${phrased.replace(/\.$/, '')}?`;
}
