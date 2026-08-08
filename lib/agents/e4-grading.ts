/**
 * E4 · Answer Grading Agent
 *
 * Compares an answer to its plan-time rubric and emits OBSERVATIONS. It does not
 * emit a score, and its output schema contains no score field — invariant 7:
 * models emit observations, S1 emits numbers. That separation is what makes
 * scores reproducible and lets weights be retuned without re-running any model.
 *
 * The largest single cost in evaluation: roughly one call per question, run in
 * parallel. Pinned to temperature 0.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { GradingMode, QuestionRecord } from '../engine/types';
import { gradingSchema, type Grading } from './schemas';

const SYSTEM = `You grade one interview answer against a rubric written before the question was asked.

You produce observations. You do NOT produce a score, a rating, or a number of any kind — a separate deterministic component does the arithmetic. Your job is to say precisely what is and is not present in the answer.

## Coverage

For each expected signal in the rubric, decide:
- covered — the answer contains it. Quote the exact span that earned it.
- partial — the answer gestures at it without establishing it. Quote the span.
- missing — not present. Leave quoted_span empty.

Quote verbatim from the transcript. A paraphrase makes the report's evidence rows unverifiable, which defeats the point of having them.

## Reading charitably

This is a spoken transcript from automatic speech recognition. It will contain mistranscriptions, dropped words, and mangled technical terms. Grade the candidate's evident meaning, not the transcription. If a term looks garbled but the surrounding reasoning is right, treat it as correct. Never mark something incorrect on the strength of one odd word.

Filler words, false starts, and self-corrections are speech, not error. Ignore them entirely.

## Grading mode — this is binding

- factual: there is a right answer. Mark incorrect_claims where they said something untrue.
- experiential: about their own work. It CANNOT be wrong. Do not populate incorrect_claims for a factual disagreement — they are describing what they did. Judge depth, ownership and specificity instead. The only thing that belongs in incorrect_claims here is a genuine technical misstatement about how something works, not a judgement about their choices.
- behavioral: about working with people. Fill in the STAR fields. Never mark wrong.
- coding: reasoning about their own code. Judge the reasoning, not the syntax.

## incorrect_claims

severity major means it would mislead them if left standing — a wrong mental model, not a slip. severity minor is a detail. Most answers have none; an empty array is the common case. Always give the correction, briefly and plainly.

## The other fields

- answered_the_question: false only when they answered a genuinely different question. Being incomplete is not the same as being off-topic.
- ownership: clear_individual when they say what THEY did; team_ambiguous for "we" throughout with no personal role; observational when they describe something that happened near them. not_applicable for factual questions.
- specificity: high when there are concrete names, numbers, and decisions; low when it stays general.
- depth_reached: surface (named it), working (used it), implementation (built it), design (weighed it against alternatives).
- one_thing_to_change: the single highest-leverage note. One sentence, actionable, addressed to the candidate.`;

export interface GradingInput {
  question: QuestionRecord;
  rubric: unknown;
  gradingMode: GradingMode;
  transcript: string;
  /** Set when the candidate barged in and did not hear the full question. */
  partiallyHeard?: boolean;
  asrConfidence?: number;
}

export async function runGrading(
  input: GradingInput,
  context?: RunContext,
): Promise<Grading> {
  const caveats: string[] = [];
  if (input.partiallyHeard) {
    caveats.push(
      'NOTE: the candidate did not hear this question in full — they began answering over it. Grade only against the part they heard, and do not penalise them for missing the rest.',
    );
  }
  if (input.asrConfidence !== undefined && input.asrConfidence < 0.85) {
    caveats.push(
      `NOTE: speech recognition confidence on this answer was low (${input.asrConfidence.toFixed(2)}). Read especially charitably.`,
    );
  }

  const result = await runAgent({
    agent: 'E4',
    schema: gradingSchema,
    system: SYSTEM,
    prompt: [
      `GRADING MODE: ${input.gradingMode}`,
      caveats.join('\n'),
      '',
      `<question>\n${input.question.text}\n</question>`,
      `<rubric>\n${JSON.stringify(input.rubric)}\n</rubric>`,
      `<answer_transcript>\n${input.transcript}\n</answer_transcript>`,
      '',
      'Grade this answer. Observations only — no scores.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: { seq: input.question.seq, mode: input.gradingMode },
  });

  return result.data;
}
