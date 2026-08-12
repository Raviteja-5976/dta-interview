/**
 * L6 · Answering the candidate's own question.
 *
 * Near the end of an interview the candidate is invited to ask something. The
 * interviewer used to take that answer, treat it as evidence for a goal, and
 * move straight to the next question — so the candidate asked "what does the
 * team's release process look like?" and got "Okay. Tell me about a time you
 * disagreed with a colleague." That reads as not listening, and it is: a real
 * interviewer answers, and what someone chooses to ask is itself signal.
 *
 * This is the ONLY component in the system that gives the candidate information
 * rather than eliciting it, which makes it the only one that could invent a fact
 * about the employer. Two things contain that:
 *
 *   · It is given the JD and the company profile and told to answer from them.
 *   · `grounded` records whether it managed to. An ungrounded answer says it
 *     does not know rather than producing something plausible — a mock
 *     interview that invents the equity split is worse than one that declines.
 *
 * Runs on the nano tier: the material is supplied, so this is summarising a
 * source, not reasoning about one.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { candidateQuestionAnswerSchema, type CandidateQuestionAnswer } from './schemas';

const SYSTEM = `You are an interviewer. The candidate has just said something, and you need to work out whether they asked you a question — and if so, answer it.

## Is it a question?

is_question is true only when they are actually asking you something: about the role, the team, the company, the process, the technology, what happens next.

It is NOT a question when they are answering yours, thinking out loud ("...is that what you meant?"), checking they were understood ("does that make sense?"), or declining the invitation ("no, I think you've covered it"). Those get is_question false and empty strings.

## Answering

You are given the job description and what is known about the company. Answer from that material.

- Be specific where the material is specific. Name the technology, the responsibility, the value — quoting what the posting actually says is more useful than a paraphrase of it.
- Be brief. Two or three sentences spoken aloud. This is a pause in the interview, not a segment of it.
- Sound like a person who works there, not a brochure. No "we're passionate about", no "fast-paced environment".
- Then hand the floor back cleanly. One short line — you are about to continue the interview.

## When the material does not cover it

Say so plainly, offer what you do have, and set grounded to false:
  "Honestly, that's not something I can speak to from here — compensation would be a conversation with the recruiter. What I can tell you is the role sits in the platform team."

Never invent a number, a policy, a team size, a salary band, or a name. Someone practising for a real interview must not walk in repeating a detail this system made up. If you cannot support it from the material, you do not know it.

grounded is true only when the substance of your answer came from the job description or the company material.`;

export interface CandidateQuestionInput {
  /** What the candidate just said, verbatim. */
  transcript: string;
  /** The question they were responding to, so an answer is not mistaken for a query. */
  askedQuestion: string;
  roleTitle: string;
  companyName: string;
  /** Compact JD digest — responsibilities and required skills. */
  jdContext?: string;
  /** Compact company digest — what they do, stack, culture signals. */
  companyContext?: string;
}

export async function runCandidateQuestion(
  input: CandidateQuestionInput,
  context?: RunContext,
): Promise<CandidateQuestionAnswer> {
  const result = await runAgent({
    agent: 'L6',
    schema: candidateQuestionAnswerSchema,
    system: SYSTEM,
    prompt: [
      `ROLE: ${input.roleTitle} at ${input.companyName}`,
      input.jdContext ? `<job_description>\n${input.jdContext}\n</job_description>` : '',
      input.companyContext ? `<company>\n${input.companyContext}\n</company>` : '',
      !input.jdContext && !input.companyContext
        ? '(No job description or company material available — you can only answer in general terms, and grounded must be false.)'
        : '',
      '',
      `<you_asked>\n${input.askedQuestion}\n</you_asked>`,
      `<they_said>\n${input.transcript}\n</they_said>`,
      '',
      'Did they ask you something? If so, answer it.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    // Silence beats invention: on timeout the interview continues as it did
    // before, which is the behaviour this replaces rather than a regression.
    fallback: () => ({
      v: 2 as const,
      is_question: false,
      question_summary: '',
      answer: '',
      grounded: false,
    }),
  });

  return result.data;
}
