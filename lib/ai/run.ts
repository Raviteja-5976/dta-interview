/**
 * `runAgent` — the single entry point every LLM agent in this system goes through.
 *
 * It owns the five things that must not be re-implemented per agent:
 *   1. Provider/model resolution (env-driven, see config.ts)
 *   2. A hard wall-clock timeout per attempt
 *   3. Retries with backoff, on transport errors only
 *   4. Fallback on failure — invariant 12, degrade texture, never terminate
 *   5. Cost/latency/token accounting into `agent_runs`
 *
 * Agents supply a Zod schema and prompts. They never see a model name, an API
 * key, or a retry loop.
 */

import { generateObject, NoObjectGeneratedError } from 'ai';
import type { z } from 'zod';

import type { AgentId, AgentRunResult, RunContext } from './types';
import { computeCostUsd } from './catalog';
import { getPolicy } from './config';
import { resolveModelForAgent, MissingProviderKeyError } from './registry';
import { recordAgentRun } from './telemetry';

/**
 * `generateObject`'s return type is a conditional over the schema's *inferred*
 * type, which TypeScript cannot evaluate while the schema is still a generic
 * parameter. This adapter pins it to the one shape we ever use — an object
 * output — in a single place rather than casting at every call site.
 *
 * The looser typing costs nothing in safety: `generateObject` validates the
 * model's output against the Zod schema at runtime and throws
 * `NoObjectGeneratedError` on a mismatch, so `object` really is `T` by the time
 * we return it.
 */
const generateObjectLoose = generateObject as unknown as (args: {
  model: unknown;
  schema: unknown;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries: number;
  abortSignal: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}) => Promise<{
  object: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
}>;

export class AgentError extends Error {
  constructor(
    readonly agent: AgentId,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${agent}] ${message}`);
    this.name = 'AgentError';
  }
}

export interface RunAgentOptions<T> {
  agent: AgentId;
  /** Zod schema describing the agent's output contract. */
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Ownership, for `agent_runs` attribution. */
  context?: RunContext;
  /**
   * Used when every attempt fails. Supply this for live-loop agents, where a
   * slightly worse turn always beats a broken one. Omit it for prep and
   * evaluation agents, where failure should surface as a `failed` status and a
   * retry the user can see — a silently degraded report is worse than none.
   */
  fallback?: () => T;
  /** Overrides the policy timeout for this call only. */
  timeoutMs?: number;
  /** Extra fields merged into `agent_runs.meta`. */
  meta?: Record<string, unknown>;
  /** Raw provider options passthrough, e.g. disabling Google structured outputs. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

export async function runAgent<T>(opts: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
  const { agent, schema, system, prompt, context, fallback, meta } = opts;
  const policy = getPolicy(agent);
  const timeoutMs = opts.timeoutMs ?? policy.timeoutMs;

  const started = Date.now();
  let resolved: ReturnType<typeof resolveModelForAgent>;

  try {
    resolved = resolveModelForAgent(agent);
  } catch (err) {
    // No API key for this agent's provider. Nothing to retry.
    const latencyMs = Date.now() - started;
    if (err instanceof MissingProviderKeyError && fallback) {
      return fallbackResult(agent, fallback, latencyMs, err.message);
    }
    throw new AgentError(agent, err instanceof Error ? err.message : 'Provider unavailable', err);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let attempts = 0;
  let lastError: unknown;

  const maxAttempts = policy.maxRetries + 1;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const result = await generateObjectLoose({
        model: resolved.model,
        schema,
        system,
        prompt,
        // Only sent to models that accept it. OpenAI's reasoning family rejects
        // it outright — sending it anyway earns a warning and the value is
        // discarded, which silently disables anything that depended on it.
        temperature: resolved.spec.supportsTemperature ? policy.temperature : undefined,
        maxOutputTokens: policy.maxOutputTokens,
        // Retries are handled here, not inside the SDK, so each attempt gets its
        // own clean timeout and every attempt is counted in telemetry.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
        providerOptions: buildProviderOptions(resolved, policy, opts.providerOptions),
      });

      inputTokens += result.usage?.inputTokens ?? 0;
      outputTokens += result.usage?.outputTokens ?? 0;
      reasoningTokens += result.usage?.reasoningTokens ?? 0;

      const latencyMs = Date.now() - started;
      const costUsd = computeCostUsd(resolved.spec, inputTokens, outputTokens);

      recordAgentRun({
        agent,
        phase: policy.phase,
        provider: resolved.provider,
        model: resolved.modelId,
        latencyMs,
        inputTokens,
        outputTokens,
        costUsd,
        ok: true,
        context,
        meta: {
          ...meta,
          attempts,
          tier: policy.tier,
          overridden: resolved.isOverridden,
          reasoning_effort: policy.reasoningEffort,
          // Billed as output but invisible in the response — usually the reason
          // a call cost more than its visible output suggests.
          reasoning_tokens: reasoningTokens || undefined,
        },
      });

      return {
        ok: true,
        data: result.object as T,
        fromFallback: false,
        meta: {
          agent,
          provider: resolved.provider,
          model: resolved.modelId,
          latencyMs,
          inputTokens,
          outputTokens,
          reasoningTokens: reasoningTokens || undefined,
          costUsd,
          attempts,
        },
      };
    } catch (err) {
      lastError = err;

      // A schema violation will repeat on retry with temperature 0, and the
      // live loop has no time for a second attempt anyway.
      const worthRetrying = attempts < maxAttempts && isTransient(err);
      if (!worthRetrying) break;

      await sleep(backoffMs(attempts));
    }
  }

  const latencyMs = Date.now() - started;
  const errorMessage = describeError(lastError);

  recordAgentRun({
    agent,
    phase: policy.phase,
    provider: resolved.provider,
    model: resolved.modelId,
    latencyMs,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    costUsd: computeCostUsd(resolved.spec, inputTokens, outputTokens),
    ok: false,
    context,
    meta: { ...meta, attempts, tier: policy.tier, error: errorMessage },
  });

  if (fallback) {
    return fallbackResult(agent, fallback, latencyMs, errorMessage, {
      provider: resolved.provider,
      model: resolved.modelId,
      attempts,
    });
  }

  throw new AgentError(agent, errorMessage, lastError);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Provider-specific knobs.
 *
 * On OpenAI's reasoning family, `reasoningEffort` replaces `temperature` as the
 * quality/cost/latency dial. `none` is a real setting, not a degraded one: L1
 * picks from at most eight options the rule layer already filtered, and L4 words
 * a question someone else chose. Neither has anything to reason about, and
 * thinking tokens would buy latency and cost for no gain.
 *
 * Caller-supplied options win, so an agent can still override per call.
 */
function buildProviderOptions(
  resolved: ReturnType<typeof resolveModelForAgent>,
  policy: ReturnType<typeof getPolicy>,
  extra?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
  if (!resolved.spec.supportsReasoningEffort) return extra;

  const openai: Record<string, unknown> = {};
  if (policy.reasoningEffort) openai.reasoningEffort = policy.reasoningEffort;
  if (policy.textVerbosity) openai.textVerbosity = policy.textVerbosity;

  if (Object.keys(openai).length === 0) return extra;

  return { ...extra, openai: { ...openai, ...extra?.openai } };
}

function fallbackResult<T>(
  agent: AgentId,
  fallback: () => T,
  latencyMs: number,
  error: string,
  extra?: { provider: AgentRunResult<T>['meta']['provider']; model: string; attempts: number },
): AgentRunResult<T> {
  return {
    ok: false,
    data: fallback(),
    fromFallback: true,
    meta: {
      agent,
      provider: extra?.provider ?? 'openai',
      model: extra?.model ?? 'unavailable',
      latencyMs,
      attempts: extra?.attempts ?? 0,
      error,
    },
  };
}

/**
 * Transport-ish failures are worth another attempt; a malformed object or an
 * aborted call is not. Timeouts specifically are NOT retried — the budget that
 * expired is a wall-clock budget, and spending it twice misses the point.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return false;
    if (NoObjectGeneratedError.isInstance(err)) return false;

    const status = (err as { statusCode?: number; status?: number }).statusCode ??
      (err as { status?: number }).status;
    if (typeof status === 'number') {
      // 408/409/429 and 5xx are worth retrying; other 4xx are our fault.
      return status === 408 || status === 409 || status === 429 || status >= 500;
    }
    return /network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(err.message);
  }
  return false;
}

function backoffMs(attempt: number): number {
  // 300ms, 900ms — with jitter so parallel E4 calls don't retry in lockstep.
  return Math.round(300 * 3 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
    if (NoObjectGeneratedError.isInstance(err)) return 'schema_violation';
    return err.message.slice(0, 300);
  }
  return 'unknown_error';
}
