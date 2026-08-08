/**
 * E3 · Evidence & Knowledge Router
 *
 * Runs for FACTUAL questions only, and only when the rubric's volatility says the
 * answer could have moved. Knowledge routing by volatility is what stops this
 * agent from being an expensive no-op: stable fundamentals never trigger a lookup
 * (D10), which is a large part of why an interview stays cheap.
 *
 * Deferred in the MVP per agentdesign.md §11 — wire it in when you add web search.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { evidenceRouterSchema, type EvidenceRouterResult } from './schemas';

const SYSTEM = `You decide whether a candidate's factual claim needs external verification, and if so, what the correct position is.

Set verification_needed=false when the topic is settled: language semantics, data-structure complexity, how TCP works, what an index costs. Your own knowledge is reliable there and a lookup would waste time and money.

Set verification_needed=true only when the answer genuinely depends on a specific version, a recent release, or a currently-moving default — where what was true two years ago is now wrong.

For each finding:
- supported: the candidate is right.
- contradicted: they are wrong. Explain what is actually the case, briefly.
- inconclusive: it depends on context they did not specify. Say what it depends on. This is often the honest answer and you should not avoid it.

Never mark contradicted on the strength of a preference or a style choice. Only facts.`;

export interface EvidenceRouterInput {
  questionText: string;
  transcript: string;
  volatility: 'stable' | 'versioned' | 'volatile';
  claims: string[];
}

/**
 * Returns null without a model call when volatility says a lookup is pointless.
 * This early return is the cost control, not an optimisation detail.
 */
export async function runEvidenceRouter(
  input: EvidenceRouterInput,
  context?: RunContext,
): Promise<EvidenceRouterResult | null> {
  if (input.volatility === 'stable' || input.claims.length === 0) return null;

  const result = await runAgent({
    agent: 'E3',
    schema: evidenceRouterSchema,
    system: SYSTEM,
    prompt: [
      `Volatility of this topic: ${input.volatility}`,
      `<question>\n${input.questionText}\n</question>`,
      `<answer>\n${input.transcript}\n</answer>`,
      `<claims_to_check>\n${input.claims.join('\n')}\n</claims_to_check>`,
    ].join('\n'),
    context,
    fallback: () => ({ verification_needed: false, findings: [] }),
  });

  return result.fromFallback ? null : result.data;
}
