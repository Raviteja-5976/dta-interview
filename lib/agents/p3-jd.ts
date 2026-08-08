/**
 * P3 · JD Parser Agent
 *
 * Job posting → required vs preferred, seniority, responsibilities, and the
 * expectations the posting implies without stating.
 *
 * Runs on the `nano` tier. agentdesign.md rates this Haiku/Flash-class, and it
 * is genuinely structural work — the posting says what it says.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { jdProfileSchema, type JdProfile } from './schemas';

const SYSTEM = `You are parsing a job posting so an interview can be built against it.

Separate required from preferred rigorously. Postings blur this deliberately; you should not. "Must have", "required", and years-of-experience statements are required. "Nice to have", "bonus", "a plus", and "familiarity with" are preferred.

importance (0-1) is how much this skill actually matters for the role as described — not how prominently it appears. A skill named once in the core responsibilities outranks one buried in a list of twelve.

derived_from must quote the phrase in the posting the item came from. If you cannot point at a phrase, do not include the item.

implicit_expectations are the things the posting assumes without saying:
- "own the service end to end" implies on-call and production debugging
- "work with the data team" implies SQL beyond selects
- a small startup implies breadth over depth
State what the expectation is and what wording implied it.

If the posting does not indicate seniority, use "unknown". Do not guess from salary or company size.`;

export async function runJdParser(
  input: { jdText: string },
  context?: RunContext,
): Promise<JdProfile> {
  const result = await runAgent({
    agent: 'P3',
    schema: jdProfileSchema,
    system: SYSTEM,
    prompt: `Parse this job description.\n\n<job_description>\n${input.jdText}\n</job_description>`,
    context,
    meta: { jd_chars: input.jdText.length },
  });
  return result.data;
}
