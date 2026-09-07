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
- skill: the hands-on round — something built or fixed in the editor. You are NOT reviewing the code here; a separate reader does that against the requirements. Judge only what the transcript shows about how they worked: did they say what they were doing and why, did they consider anything they rejected, did they notice their own mistakes.

## Grading against the resume

For experiential and behavioral answers you are given the candidate's resume. Use it, because these questions have no factually correct answer and the resume is the only thing their account can be checked against. "Why did you build Hyrzo?" cannot be marked right or wrong — but it can be measured against what they wrote down.

What the resume lets you observe:
- CONSISTENCY — does the account match the claim? A resume saying "led a team of four" against an answer describing solo work is a real observation. Record it in observations, plainly and without accusation. People compress and misremember; the report notes the gap, it does not allege anything.
- SPECIFICITY BEYOND THE PAGE — someone who lived the work supplies detail the resume does not contain: the thing that broke, the number they measured, the approach they rejected. An answer that only restates the bullet point is thin, however fluent it sounds. This is the single strongest signal you have on an experiential question, so weigh it in \`specificity\` and \`depth_reached\`.
- SCOPE — the resume says what they claim to have owned. \`ownership\` should reflect what the ANSWER establishes, and where the two disagree, note it.

Never mark an experiential answer wrong for diverging from the resume. A resume is a summary written months earlier, not ground truth. The divergence is the observation; the judgement is not yours to make.

## coding — fill this in for coding and skill answers only, otherwise null

You are given the submitted source and, for a coding answer, the test results. The pass rate is already measured and is NOT yours to judge — assess the three things a test runner cannot:
- complexity_match: how close the solution is to the stated target complexity. A correct brute force where the target was O(n log n) scores low here even at 100% passing.
- code_quality: naming, structure, edge-case handling. Not formatting, not style preferences.
- verbal_reasoning: did they explain the approach as they worked? Judge from the transcript around the submission. Silence while typing scores low even for perfect code — thinking out loud is what a coding interview is actually testing.

On a SKILL answer, verbal_reasoning is the field that is used and the other two are not. Fill all three anyway, but spend your attention on that one.

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
  /**
   * What the candidate claimed on paper, for experiential and behavioral modes.
   *
   * Trimmed to the projects and probe-worthy claims — the parts an answer can
   * actually be checked against. Omitted for factual questions, where the resume
   * is irrelevant and would only be prompt weight.
   */
  resumeContext?: string;
  /** Sandbox results for a coding submission. Measured, never judged (§9.5). */
  codingContext?: { passed: number; total: number; language: string; source: string };
  /**
   * The skill round's submission.
   *
   * No test tally, because nothing ran. The requirements are deliberately NOT
   * passed: SV grades against those, and handing them to E4 as well would
   * produce a second opinion on the same question that S1 has no way to
   * reconcile with the first.
   */
  skillContext?: { skill: string; format: string; language: string; source: string };
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
      input.resumeContext
        ? `<resume_claims>\n${input.resumeContext}\n</resume_claims>`
        : '',
      `<answer_transcript>\n${input.transcript}\n</answer_transcript>`,
      input.codingContext
        ? [
            '',
            `<submission language="${input.codingContext.language}">`,
            input.codingContext.source.slice(0, 4000),
            '</submission>',
            `Sandbox result: ${input.codingContext.passed} of ${input.codingContext.total} tests passed. ` +
              'This is measured fact — do not re-judge it. Fill in the `coding` block.',
          ].join('\n')
        : '',
      input.skillContext
        ? [
            '',
            `<submission skill="${input.skillContext.skill}" format="${input.skillContext.format}" language="${input.skillContext.language}">`,
            input.skillContext.source.slice(0, 4000),
            '</submission>',
            'Nothing was executed and the code is reviewed elsewhere. Fill in the `coding` block, ' +
              'and put your attention on `verbal_reasoning`: what the transcript shows about how they worked.',
          ].join('\n')
        : '',
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
