/**
 * L2 · Structured Interview Memory — the extraction agent.
 *
 * Runs ASYNCHRONOUSLY, after the turn has already moved on. This is not an
 * optimisation, it is a dependency rule (§2.3): memory pays off from the *next*
 * turn onward, so blocking on it would double turn latency for nothing.
 * agentdesign.md §10 is explicit that it must never be moved inline "just to get
 * fresher callbacks".
 *
 * `nano` tier accordingly — nothing is waiting on it.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { memoryExtractionSchema, type MemoryExtraction } from './schemas';

const SYSTEM = `You maintain an interviewer's working model of the candidate they are talking to.

You read one question-and-answer exchange and extract what a sharp interviewer would remember from it. Not a summary — specific, reusable items.

Extract only what the candidate actually said. Never infer a project they did not describe or a technology they did not name.

The kinds that matter most:
- unverified_claim: they asserted something notable with nothing behind it — a metric with no baseline, an outcome with no method, a scale figure with no context. These are the highest-value items in the store.
- project: something they built, with the technologies named.
- weakness: a place they deflected, hedged, or could not answer. Record it neutrally and factually.
- metric: any number they quoted.
- story: a specific incident that could be revisited.
- leadership_example / behavioral_example: material for the behavioural section.

callback_candidates are the payoff. A callback must be answerable and must name the thing:
  good: "how did you decide what to embed?" for a Pinecone chatbot
  bad:  "tell me more about that project"
Set value high only when answering it would genuinely establish something. Give at most two per item, and none at all if nothing is worth returning to.

contradictions: only flag a real inconsistency between what they said now and what they said earlier — "solo" then "four of us", a date that cannot be right. A rephrasing is not a contradiction, and neither is a correction they made themselves. Set probe=false unless resolving it would change your read of the candidate; most contradictions belong in the report, not in the interview.

importance is how much this matters for the remaining interview. confidence is how sure you are you understood them correctly — lower it when the transcript looks garbled.`;

export interface MemoryExtractionInput {
  questionText: string;
  answerTranscript: string;
  /** Goal ids currently open, so callbacks can be aimed at one. */
  openGoalIds: string[];
  knownLabels: string[];
}

export async function runMemoryExtraction(
  input: MemoryExtractionInput,
  context?: RunContext,
): Promise<MemoryExtraction> {
  const result = await runAgent({
    agent: 'L2',
    schema: memoryExtractionSchema,
    system: SYSTEM,
    prompt: [
      `Goals still open (aim callbacks at one of these): ${input.openGoalIds.join(', ') || 'none'}`,
      `Already in memory (do not duplicate, but do elaborate): ${input.knownLabels.join(' | ') || 'nothing yet'}`,
      '',
      `<question>\n${input.questionText}\n</question>`,
      `<answer>\n${input.answerTranscript}\n</answer>`,
      '',
      'Extract what is worth remembering.',
    ].join('\n'),
    context,
    // Async and non-blocking: an empty extraction costs a callback opportunity
    // and nothing else, so it degrades cleanly.
    fallback: () => ({ items: [], contradictions: [] }),
  });

  return result.data;
}
