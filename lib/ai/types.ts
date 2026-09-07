/**
 * Core types for the provider-agnostic model layer.
 *
 * The whole point of this file: no agent anywhere in the codebase ever names a
 * concrete model. Agents declare a *capability tier* ("I need a fast, cheap
 * model") and the catalog resolves that to a real model id for whichever
 * provider is active. Switching the entire system from OpenAI to Gemini or Grok
 * is one environment variable.
 */

/** Providers we can route to. Adding another means touching catalog.ts only. */
export type ProviderId = 'openai' | 'google' | 'xai' | 'groq';

/**
 * Capability tiers, ordered by cost. An agent picks the *cheapest tier that can
 * do its job* — see config.ts for the per-agent assignment and its reasoning.
 *
 * - `nano`     — structural extraction, classification, high volume. Cheapest.
 * - `fast`     — the live loop (L1/L4). Latency is the binding constraint, not
 *                intelligence; these calls sit inside a ~1.25s turn budget.
 * - `balanced` — the default for prep and evaluation reasoning.
 * - `deep`     — reserved for P6 (the blueprint). The one place where output
 *                quality compounds across the entire interview.
 */
export type ModelTier = 'nano' | 'fast' | 'balanced' | 'deep';

/**
 * Agent identifiers, matching the IDs in reference/agentdesign.md §1 so that
 * logs, traces, and the `agent_runs` table line up with the design document.
 *
 * Only agents that make a model call appear here. O1, L3, L5, E1, E2 and S1 are
 * deterministic services and live in lib/engine — by design (invariants 1, 5, 7).
 */
export type AgentId =
  | 'P1' // Company Research
  | 'P2' // Resume Parser
  | 'P3' // JD Parser
  | 'P4' // Gap Analysis
  | 'P5' // Interview Strategy
  | 'P6' // Interview Blueprint
  | 'P7' // Coding Challenge (DSA, with hidden tests)
  | 'SC' // Skill Challenge — the hands-on task, no hidden tests to get right
  | 'IV' // Live Interviewer — decides what to ask AND says it, in one call
  | 'L2' // Structured Interview Memory
  | 'L3' // Live evidence verification (runs concurrently with IV)
  | 'E3' // Evidence & Knowledge Router
  | 'E4' // Answer Grading
  | 'SV' // Skill Challenge Validation (the round with no sandbox)
  | 'E5' // Rewrite Coach
  | 'E6' // Report Composer
  | 'RI' // Ideal Resume — what can honestly be sent today
  | 'SP' // Study Plan — the timetable and the projects worth building
  | 'TR'; // Target Resume — what the resume says once the plan is done

/** Which phase an agent belongs to. Written to `agent_runs.phase`. */
export type AgentPhase = 'prep' | 'live' | 'eval';

/**
 * Price per 1M tokens. Some providers charge more above a context threshold
 * (xAI at 200k, Gemini Pro at 200k), which `longContextFrom` models.
 */
export interface ModelPricing {
  input: number;
  output: number;
  /** Token count at or above which the long-context rates apply. */
  longContextFrom?: number;
  inputLong?: number;
  outputLong?: number;
}

/**
 * How hard a reasoning model thinks before answering. Reasoning tokens are
 * invisible in the response but are billed as output tokens and cost real
 * latency, so this is simultaneously the quality dial, the cost dial and the
 * speed dial.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * The effort ladder, cheapest and fastest first.
 *
 * Not every model accepts every rung — `gpt-5.6-luna` rejects `minimal` outright
 * with a 400, even though the provider documents it as a valid value. The
 * documented list is the union across a family; per-model support is narrower.
 * `ModelSpec.reasoningEfforts` records what a given model actually takes, and
 * `resolveReasoningEffort` maps a request onto it.
 */
export const REASONING_LADDER: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export interface ModelSpec {
  /** The provider's own model id, passed through verbatim. */
  id: string;
  pricing: ModelPricing;
  /** Total context window in tokens, for budgeting long prompts. */
  contextWindow: number;
  /**
   * Whether the provider reliably honours a JSON schema. When false, run.ts
   * falls back to prompt-level JSON coercion and validates with Zod anyway.
   */
  structuredOutputs: boolean;
  /**
   * Reasoning models reject `temperature` outright. Sending it anyway earns a
   * warning and the value is discarded — so any behaviour that depends on it is
   * silently not happening.
   */
  supportsTemperature: boolean;
  /** Whether `reasoningEffort` is the lever instead. */
  supportsReasoningEffort: boolean;
  /**
   * The effort values this specific model accepts. Anything else is a 400, so a
   * requested value outside this list is mapped to the nearest one that works.
   */
  reasoningEfforts?: ReasoningEffort[];
}

/** Per-agent execution policy. See config.ts. */
export interface AgentPolicy {
  tier: ModelTier;
  phase: AgentPhase;
  /**
   * The provider this agent belongs on, regardless of AI_PROVIDER.
   *
   * Almost no agent should set this — the whole point of the tier system is
   * that agents state intent and the system routes them. It exists for the one
   * case where the provider IS the requirement rather than a preference: the
   * live interviewer runs inside the silence after a candidate stops talking,
   * so time-to-first-token is its binding constraint and moving it to a slower
   * provider does not make it cheaper, it makes the product feel broken.
   *
   * Still overridable per agent by AI_PROVIDER_<AGENT>, which is the escape
   * hatch for measuring exactly that claim.
   */
  provider?: ProviderId;
  /**
   * Hard wall-clock ceiling in ms. On expiry the call is aborted and the
   * caller's fallback is used — invariant 12: degrade texture, never terminate.
   */
  timeoutMs: number;
  /** Retries on transient failure. Live-loop agents get 0: there is no time. */
  maxRetries: number;
  /**
   * Only sent to models that accept it (see `ModelSpec.supportsTemperature`).
   * Kept because Gemini and Grok do honour it — on OpenAI's reasoning family it
   * is `reasoningEffort` that does this job.
   */
  temperature?: number;
  /**
   * The primary quality/cost/latency dial on reasoning models.
   *
   * `none` is not a degraded setting — for an agent choosing among eight
   * pre-filtered options, or wording a question someone else chose, there is
   * nothing to reason about, and thinking tokens buy latency and cost for no gain.
   */
  reasoningEffort?: ReasoningEffort;
  /** Keeps generated string fields terse where the schema is the real output. */
  textVerbosity?: 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  /** One line on why this tier — kept next to the decision, not in a doc. */
  rationale: string;
}

/** What every agent call returns, successful or not. */
export interface AgentRunResult<T> {
  ok: boolean;
  data: T;
  /** True when `data` came from the caller's fallback rather than the model. */
  fromFallback: boolean;
  meta: {
    agent: AgentId;
    provider: ProviderId;
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    /**
     * Thinking tokens. Invisible in the response, billed as output, and the
     * usual reason a call cost more or took longer than the visible output
     * suggests. Worth watching per agent.
     */
    reasoningTokens?: number;
    /** USD, computed from the catalog. `undefined` if token usage was absent. */
    costUsd?: number;
    attempts: number;
    error?: string;
  };
}

/** Ownership context so a run can be attributed in `agent_runs`. */
export interface RunContext {
  userId?: string;
  projectId?: string;
  sessionId?: string;
}
