/**
 * Per-agent execution policy and provider resolution.
 *
 * Two things live here:
 *   1. Which capability tier each agent gets, and why (cost control happens here).
 *   2. How a provider is chosen at call time — globally or per agent.
 *
 * ── Switching providers ──────────────────────────────────────────────────────
 *   AI_PROVIDER=openai            # everything (default)
 *   AI_PROVIDER=google            # flip the whole system to Gemini
 *   AI_PROVIDER_P6=google         # ...or just the blueprint agent
 *   AI_MODEL_P6=gemini-3.1-pro    # escape hatch: pin one agent to an exact model
 *
 * Overrides are read per call, so nothing needs a redeploy to move.
 */

import type { AgentId, AgentPolicy, ModelTier, ProviderId } from './types';
import { isProviderId } from './catalog';

/**
 * Tier assignment. The comment on each line is the cost argument, because that
 * is the thing most likely to be revisited.
 *
 * Only two agents sit on `deep`, and both for the same reason: they generate
 * artifacts that everything downstream is graded against, so an error there is
 * not a slightly worse interview — it is a wrong one. Everything else runs on the
 * cheap tier, which is affordable precisely because those artifacts are good.
 *
 * Rough per-session shape on OpenAI, at the ladder in catalog.ts:
 *   P6 blueprint (deep)          ~$0.13   ← largest single call
 *   P7 challenges (deep, 1-3)    ~$0.19   only when coding is on
 *   E4 grading (~15 calls)       ~$0.03
 *   L1 + L4 (~50 calls)          ~$0.03
 *   E5 + E6                      ~$0.04
 *   STT + TTS                    ~$0.07
 *   ────────────────────────────────────
 *   ~$0.30 plain · ~$0.50 with coding, against ~$0.85 of revenue.
 * Treat those as estimates, and read `agent_runs` for the real numbers.
 */
export const AGENT_POLICY: Record<AgentId, AgentPolicy> = {
  // ── Phase 1 · Preparation ─────────────────────────────────────────────────
  P1: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 45_000,
    maxRetries: 1,
    temperature: 0.2,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 3_000,
    rationale:
      'Reads a company site and synthesises a profile. Results are cached in company_cache and shared across every user interviewing there, so the cost amortises hard.',
  },
  P2: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 6_000,
    rationale:
      'Not flat extraction — it has to spot which claims are worth probing, which is judgement. Runs once per resume version.',
  },
  P3: {
    tier: 'nano',
    phase: 'prep',
    timeoutMs: 30_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale:
      'Structural extraction from a job posting. agentdesign.md rates it Haiku/Flash-class; the cheapest tier handles it.',
  },
  P4: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'medium',
    textVerbosity: 'low',
    maxOutputTokens: 6_000,
    rationale:
      'Joins resume x JD x company and ranks what the interview must investigate. Everything downstream inherits its ranking.',
  },
  P5: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'medium',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale: 'Decides interview shape: time allocation, difficulty ramp, stop rules. Small output, high leverage.',
  },
  P6: {
    tier: 'deep',
    phase: 'prep',
    // High reasoning on a large structured output genuinely takes a minute or
    // two. A timeout here is NOT retried (see isTransient in run.ts), so this
    // ceiling is also the worst case for the whole prep route.
    timeoutMs: 180_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'high',
    // Visible-output budget only — run.ts adds the reasoning headroom on top.
    maxOutputTokens: 16_000,
    textVerbosity: 'medium',
    rationale:
      'One call per session produces every goal, question and rubric. Its output is what all ~25 live turns navigate and what the entire evaluation phase grades against, so quality here compounds further than anywhere else in the system. Worth 10x the unit cost of the cheap tier; not worth 25x for the frontier one.',
  },
  P7: {
    tier: 'deep',
    phase: 'prep',
    timeoutMs: 120_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'high',
    // Three languages of starter code, hidden tests and a reference solution.
    maxOutputTokens: 10_000,
    textVerbosity: 'medium',
    rationale:
      'On `deep` for one specific reason: it has to write hidden test cases whose expected values are arithmetically correct for its own reference solution. A wrong expected value fails a candidate whose code was right — the worst defect this system can ship, and exactly the kind of careless arithmetic a cheap model produces. Only runs when a module is enabled.',
  },

  // ── Phase 2 · Live loop ───────────────────────────────────────────────────
  // Called ~25x per interview each. Cheapest tier, zero retries: inside a turn
  // there is no time to try again (agentdesign.md §10).
  //
  // ── On these timeouts ─────────────────────────────────────────────────────
  // §10 specifies 550ms for L1 and 350ms for L4. Those budgets assume the app
  // sits next to the provider. From a machine in India to OpenAI, the network
  // round trip alone eats most of that, so the original numbers would have
  // fallen back on essentially every turn — and a permanent fallback is worse
  // than a slower turn, because it silently removes all adaptivity: L1 would
  // always take the rule layer's top pick and L4 would always emit the neutral
  // plan. The interviewer would still work; it would just stop listening.
  //
  // These defaults are what actually completes. Lower them toward §10 once
  // deployed near the provider — AI_TIMEOUT_L1 / AI_TIMEOUT_L4, no redeploy.
  L1: {
    tier: 'fast',
    phase: 'live',
    timeoutMs: 1_200,
    maxRetries: 0,
    temperature: 0.2,
    reasoningEffort: 'none',
    textVerbosity: 'low',
    maxOutputTokens: 400,
    rationale:
      'Blocking, ~25 calls per interview. Input is fixed-shape and never contains the transcript, so the prompt stays small and the cheap tier is genuinely sufficient. reasoningEffort none: the rule layer already narrowed the field to at most eight legal actions, so this is selection, not deliberation.',
  },
  L2: {
    tier: 'nano',
    phase: 'live',
    timeoutMs: 8_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 1_500,
    rationale: 'Async and off the critical path by design. Never blocks a turn, so it gets the cheapest tier and a generous timeout.',
  },
  L3: {
    tier: 'nano',
    phase: 'live',
    // Launched BEFORE L1 and awaited AFTER L4, so its budget is the two of them
    // back to back. At 2s it lands inside that window and adds no wall clock to
    // the turn; past it, the turn proceeds on the lexical marks alone.
    timeoutMs: 2_000,
    maxRetries: 0,
    temperature: 0,
    reasoningEffort: 'none',
    textVerbosity: 'low',
    maxOutputTokens: 600,
    rationale:
      'Decides which evidence items an answer actually established — the number the whole report is built from, and the input that decides whether a goal stays open. Runs concurrently with L1 so it is free in wall-clock terms, and on the cheapest tier because the task is bounded: it rules on at most 8 ids it was handed, against one answer, with no reasoning budget.',
  },
  L4: {
    tier: 'fast',
    phase: 'live',
    timeoutMs: 900,
    maxRetries: 0,
    // Warm, for the providers that honour it: wording variety is this agent's
    // entire job. On OpenAI's reasoning family temperature is ignored, and the
    // model's own sampling supplies the variety instead — R6 enforces the
    // no-repeated-acknowledgement rule in code either way, so nothing depends
    // on this value being applied.
    temperature: 0.7,
    reasoningEffort: 'none',
    textVerbosity: 'low',
    maxOutputTokens: 500,
    rationale:
      'Blocking, ~25 calls per interview. Wraps a question in words — it never decides substance, so it needs speed, not depth. reasoningEffort none for the same reason: there is no decision left to make by the time it runs.',
  },

  L6: {
    tier: 'nano',
    phase: 'live',
    // Longer than L1/L4 because this one is allowed to be slow: the candidate
    // just asked a question and a beat before the reply is what a person does.
    timeoutMs: 4_000,
    maxRetries: 0,
    temperature: 0.3,
    reasoningEffort: 'none',
    textVerbosity: 'low',
    maxOutputTokens: 500,
    rationale:
      'Fires at most once or twice per interview, when the candidate asks something back. The JD and company material are supplied, so this is summarising a source rather than reasoning about one — the cheapest tier is right, and the fallback is simply not answering.',
  },

  // ── Phase 3 · Evaluation ──────────────────────────────────────────────────
  // temperature 0 throughout — but note it only takes effect on Gemini and Grok.
  // OpenAI's reasoning family ignores it, so score reproducibility there rests
  // on the two mitigations that do still hold: the rubric is written at plan
  // time and pinned to the question, and S1 computes every number by formula
  // from E4's observations. agentdesign.md §12 lists score drift as a tracked
  // risk; it is worth measuring rather than assuming.
  E3: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 45_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 3_000,
    rationale: 'Only runs for factual questions on versioned topics. Volatility routing keeps the call count low.',
  },
  E4: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 60_000,
    maxRetries: 2,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale:
      'Roughly 15 parallel calls per session. The cheap tier is defensible here because the task is heavily scaffolded: P6 already wrote the rubric, the expected signals, and the literal phrases that count as covering each one, so E4 is matching an answer against a checklist rather than deciding what a good answer looks like. If grading quality ever looks thin, this is the first agent to promote — AI_PROVIDER_E4 or AI_MODEL_E4 moves it without a deploy.',
  },
  E5: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 60_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'medium',
    maxOutputTokens: 4_000,
    rationale: 'The improved/ideal answer pair is the most-read part of the report. Cheapening this is visible to the user immediately.',
  },
  E6: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 90_000,
    maxRetries: 1,
    // Slightly above zero: this one writes prose, and 0 reads flat.
    temperature: 0.2,
    reasoningEffort: 'low',
    textVerbosity: 'medium',
    maxOutputTokens: 6_000,
    rationale: 'One call per session. Writes narrative only, from numbers S1 already computed — it never invents a score.',
  },

  // ── Ad hoc ────────────────────────────────────────────────────────────────
  RI: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 90_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'low',
    textVerbosity: 'medium',
    maxOutputTokens: 8_000,
    rationale: 'User-initiated resume rewrite. Infrequent and explicitly requested, so latency matters more than unit cost.',
  },
};

/** The system-wide default provider. `AI_PROVIDER` overrides it. */
const DEFAULT_PROVIDER: ProviderId = 'openai';

/**
 * Resolve which provider handles a given agent.
 * Precedence: per-agent env override → global env → compiled default.
 */
export function resolveProvider(agent: AgentId): ProviderId {
  const perAgent = process.env[`AI_PROVIDER_${agent}`];
  if (perAgent && isProviderId(perAgent)) return perAgent;

  const global = process.env.AI_PROVIDER;
  if (global && isProviderId(global)) return global;

  return DEFAULT_PROVIDER;
}

/**
 * Escape hatch: pin one agent to an exact model id, bypassing the tier system.
 * Useful for A/B testing a new model without editing the catalog.
 */
export function resolveModelOverride(agent: AgentId): string | undefined {
  return process.env[`AI_MODEL_${agent}`] || undefined;
}

/**
 * Policy for an agent, with the timeout resolved against `AI_TIMEOUT_<AGENT>`.
 *
 * Timeouts are the one policy field worth tuning per deployment rather than per
 * codebase: the right value depends on how far the app sits from the provider,
 * and that changes between a laptop and production without a line of code
 * changing. The live-loop agents are the ones this actually matters for.
 */
export function getPolicy(agent: AgentId): AgentPolicy {
  const base = AGENT_POLICY[agent];
  const override = Number(process.env[`AI_TIMEOUT_${agent}`]);

  if (Number.isFinite(override) && override > 0) {
    return { ...base, timeoutMs: override };
  }
  return base;
}

export function getTier(agent: AgentId): ModelTier {
  return AGENT_POLICY[agent].tier;
}
