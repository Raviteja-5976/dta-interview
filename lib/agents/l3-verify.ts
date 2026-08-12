/**
 * L3v · Live evidence verification.
 *
 * L3 proper is deterministic and lexical (agentdesign.md §2.3, budget <40ms) and
 * that is right for the fast path — the shortlist has to be built before L1 runs
 * and there is no time for a model call there. But lexical matching decides
 * whether an answer COVERED something by looking for words, and candidates
 * paraphrase. In practice it produced far more false negatives than the false
 * positives §12 warns about: nothing ever verified, so every goal hit its
 * no-new-evidence ceiling on the first answer and the whole interview reduced to
 * one question per section.
 *
 * This is §12's prescribed refinement pass, made live. It runs CONCURRENTLY with
 * L1 — launched before it, merged after L4 — so it costs no wall clock in the
 * ordinary case, and its verdicts land in coverage before the next turn builds
 * its shortlist. Invariant 10 still holds for blocking calls: L1 and L4 remain
 * the only two the turn waits on in sequence.
 *
 * It judges COVERAGE, never quality. Whether the answer was good is E4's job at
 * evaluation time, and asking a live model for it would violate R5's separation
 * of observation from judgement.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { evidenceVerdictSchema, type EvidenceVerdicts } from './schemas';

const SYSTEM = `You decide which specific pieces of information a candidate's answer actually established.

You are given a question, the answer, and a list of evidence items the interviewer still needs. For each item you return a confidence between 0 and 1 that the answer ESTABLISHES it.

Establishing means the candidate supplied the substance, in their own words. It does not require the wording the evidence description uses.

  0.0-0.2  not addressed at all
  0.3-0.5  gestured at, named, or claimed without substance
  0.6-0.8  established: they said the thing, with enough specificity to believe it
  0.9-1.0  established with concrete detail — a number, a named tool, a decision they made and why

Be strict about the difference between 0.5 and 0.7. "We evaluated the model" is 0.4. "We used precision and recall because the classes were imbalanced" is 0.8. A claim with no mechanism behind it stays below 0.6 however confidently it was said.

span quotes the exact words from the answer that establish it — copied, not paraphrased. Null when confidence is below 0.6.

Return one verdict per evidence item you were given, using its id exactly. Never invent an id. Never judge whether the candidate is good; only whether they said it.`;

export interface EvidenceCheckInput {
  questionText: string;
  answerTranscript: string;
  /** Only what is still outstanding — verified items are not re-litigated. */
  outstanding: Array<{ evidence_id: string; description: string }>;
}

/**
 * Returns an empty verdict list on timeout or failure, which leaves the lexical
 * marks exactly as they were. Degrading to the fast path is always safe; the
 * turn never waits on a retry (invariant 12).
 */
export async function runEvidenceCheck(
  input: EvidenceCheckInput,
  context?: RunContext,
): Promise<{ verdicts: EvidenceVerdicts['verdicts']; fromFallback: boolean; latencyMs: number }> {
  if (input.outstanding.length === 0 || !input.answerTranscript.trim()) {
    return { verdicts: [], fromFallback: false, latencyMs: 0 };
  }

  const result = await runAgent({
    agent: 'L3',
    schema: evidenceVerdictSchema,
    system: SYSTEM,
    prompt: [
      `<question>\n${input.questionText}\n</question>`,
      '',
      `<answer>\n${input.answerTranscript}\n</answer>`,
      '',
      'EVIDENCE STILL NEEDED — return one verdict for each, by id:',
      ...input.outstanding.map((e) => `- ${e.evidence_id}: ${e.description}`),
    ].join('\n'),
    context,
    meta: { items: input.outstanding.length },
    fallback: () => ({ v: 2 as const, verdicts: [] }),
  });

  // Ids the model did not receive are dropped rather than trusted — a
  // hallucinated id would write confidence onto an unrelated evidence item.
  const allowed = new Set(input.outstanding.map((e) => e.evidence_id));

  return {
    verdicts: result.data.verdicts.filter((v) => allowed.has(v.evidence_id)),
    fromFallback: result.fromFallback,
    latencyMs: result.meta.latencyMs,
  };
}
