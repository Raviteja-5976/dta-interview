/**
 * `runAgent` — the single entry point every LLM agent in this system goes through.
 *
 * It owns the six things that must not be re-implemented per agent:
 *   1. Provider/model resolution (env-driven, see config.ts)
 *   2. A hard wall-clock timeout per attempt
 *   3. Retries with backoff, on transport errors only
 *   4. Fallback on failure — invariant 12, degrade texture, never terminate
 *   5. Cost/latency/token accounting into `agent_runs`
 *   6. Durable execution inside a pipeline pass — a call started as an OpenAI
 *      background job in one request and collected in a later one (durable.ts)
 *
 * Agents supply a Zod schema and prompts. They never see a model name, an API
 * key, a retry loop, or which request their call finishes in.
 */

import { createHash } from 'node:crypto';

import { asSchema, generateObject, NoObjectGeneratedError } from 'ai';
import type { z } from 'zod';

import type { AgentId, AgentPolicy, AgentRunResult, ReasoningEffort, RunContext } from './types';
import { computeCostUsd, resolveReasoningEffort } from './catalog';
import { getPolicy } from './config';
import { currentDurableContext, PendingWork, type DurableContext, type DurableJob } from './durable';
import {
  cancelResponse,
  createBackgroundResponse,
  isTerminal,
  isTransientHttpError,
  readOutput,
  retrieveResponse,
  type ResponseObject,
} from './openai-background';
import { resolveModelForAgent, MissingProviderKeyError, type ResolvedModel } from './registry';
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
  // Inside a pipeline pass every call is durable: started once, polled across
  // requests, and replayed from the run's state after it lands. See durable.ts.
  const durable = currentDurableContext();
  if (durable) return durable.track(runDurably(opts, durable));

  return runInline(opts);
}

/** One call, start to finish, inside this request — the live loop's path. */
async function runInline<T>(opts: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
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
        maxOutputTokens: effectiveMaxOutputTokens(resolved, policy),
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
 * Extra output budget to reserve for thinking, per effort level.
 *
 * Reasoning tokens count against `max_output_tokens` and are generated BEFORE
 * the visible answer. Set the cap to the size of the JSON you expect and the
 * model can spend the entire budget reasoning and return nothing — OpenAI's
 * docs are blunt about it: "you might get costs for input and reasoning tokens
 * without receiving a visible response."
 *
 * That failure looks exactly like a hang: an empty response fails schema
 * validation, the attempt burns its full timeout, retries, and burns it again.
 *
 * So `maxOutputTokens` in config.ts means "how much VISIBLE output this agent
 * produces", and this table adds the thinking room on top. The 25k at `high`
 * is OpenAI's own recommended starting reserve.
 */
const REASONING_HEADROOM: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 2_000,
  low: 8_000,
  medium: 16_000,
  high: 25_000,
  xhigh: 40_000,
  max: 60_000,
};

/** Visible-output budget plus thinking room, for models that reason. */
function effectiveMaxOutputTokens(
  resolved: ReturnType<typeof resolveModelForAgent>,
  policy: ReturnType<typeof getPolicy>,
): number | undefined {
  if (policy.maxOutputTokens === undefined) return undefined;
  if (!resolved.spec.supportsReasoningEffort) return policy.maxOutputTokens;

  const effort = resolveReasoningEffort(resolved.spec, policy.reasoningEffort);
  return policy.maxOutputTokens + REASONING_HEADROOM[effort ?? 'none'];
}

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

  /*
   * Provider options are namespaced by provider, and getting the namespace
   * wrong is silent: the SDK passes an unrecognised key straight through and
   * the model simply never receives the setting. That is the failure mode this
   * file exists to prevent — an agent configured for no reasoning that quietly
   * reasons anyway spends its entire latency budget on invisible tokens.
   */
  const namespace = resolved.provider;
  const options: Record<string, unknown> = {};

  // Resolved against what THIS model accepts, not just what the provider
  // documents. gpt-5.6-luna rejects `minimal` with a 400 despite it being a
  // documented value, so an unmapped effort is a runtime failure.
  const effort = resolveReasoningEffort(resolved.spec, policy.reasoningEffort);
  if (effort) options.reasoningEffort = effort;

  if (resolved.provider === 'groq') {
    /*
     * gpt-oss emits its chain of thought as part of the response. `hidden`
     * keeps it out — without it the reasoning arrives in the text channel and
     * `generateObject` fails schema validation on prose it did not expect,
     * which the live loop would see as a timeout-shaped fallback on every turn.
     */
    options.reasoningFormat = 'hidden';
    // Ask for real JSON-schema enforcement rather than best-effort JSON.
    options.structuredOutputs = true;
  } else {
    // OpenAI-only knob; Groq has no equivalent and rejects unknown fields.
    if (policy.textVerbosity) options.textVerbosity = policy.textVerbosity;
  }

  if (Object.keys(options).length === 0) return extra;

  return { ...extra, [namespace]: { ...options, ...extra?.[namespace] } };
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

// ── Durable execution ────────────────────────────────────────────────────────

/**
 * A background call's per-attempt wall clock: the agent's own timeout plus room
 * for queueing, which background requests are subject to and an inline call is
 * not. Past it the call is cancelled and counted as a timeout — and not
 * retried, the same rule `isTransient` applies inline.
 */
const BACKGROUND_QUEUE_GRACE_MS = 60_000;

/**
 * Background mode is OpenAI's. Any other provider runs inline inside the pass —
 * still memoised, so it runs once per run rather than once per pass, but bounded
 * again by the host's request limit. `AI_BACKGROUND=off` forces that path.
 */
function usesBackground(resolved: ResolvedModel): boolean {
  return resolved.provider === 'openai' && process.env.AI_BACKGROUND !== 'off';
}

/**
 * A call's identity across passes: the agent, the model, and exactly what it
 * was asked. Two passes that build the same prompt find the same job — which is
 * why durable.ts insists that anything non-deterministic feeding a prompt goes
 * through `memo`.
 */
function jobKey(agent: AgentId, model: string, system: string, prompt: string): string {
  const digest = createHash('sha256')
    .update(model)
    .update('\0')
    .update(system)
    .update('\0')
    .update(prompt)
    .digest('hex');
  return `${agent}:${digest.slice(0, 24)}`;
}

function newJob(agent: AgentId, resolved: ResolvedModel, now: number): DurableJob {
  return {
    agent,
    provider: resolved.provider,
    model: resolved.modelId,
    status: 'pending',
    responseId: null,
    startedAt: now,
    attemptStartedAt: now,
    attempts: 0,
    retryAt: null,
  };
}

async function runDurably<T>(opts: RunAgentOptions<T>, durable: DurableContext): Promise<AgentRunResult<T>> {
  const { agent } = opts;
  const policy = getPolicy(agent);

  let resolved: ResolvedModel;
  try {
    resolved = resolveModelForAgent(agent);
  } catch {
    // No key for the provider. The inline path owns that outcome — the fallback
    // or an AgentError — and there is nothing durable about it.
    return runInline(opts);
  }

  const key = jobKey(agent, resolved.modelId, opts.system, opts.prompt);
  let job = durable.state.jobs[key];

  // Settled on an earlier pass: replay it. Telemetry was written when it settled.
  if (job?.status === 'done') return replayDone(job, opts);
  if (job?.status === 'failed') return replayFailed(job, opts);

  if (!usesBackground(resolved)) return runInlineMemoised(opts, resolved, durable, key);

  if (!job) {
    if (!durable.canStartWork()) {
      durable.markPending();
      throw new PendingWork();
    }
    job = newJob(agent, resolved, Date.now());
    durable.state.jobs[key] = job;
  }

  await advanceBackgroundJob(job, opts, resolved, policy, durable);

  if (job.status === 'pending') {
    durable.markPending();
    throw new PendingWork();
  }

  recordSettledJob(job, opts, resolved, policy);
  return job.status === 'done' ? replayDone(job, opts) : replayFailed(job, opts);
}

/**
 * Moves one background call as far as it will go in this request: starts it,
 * restarts it after a transient failure, or polls it.
 */
async function advanceBackgroundJob<T>(
  job: DurableJob,
  opts: RunAgentOptions<T>,
  resolved: ResolvedModel,
  policy: AgentPolicy,
  durable: DurableContext,
): Promise<void> {
  const now = Date.now();
  const deadlineMs = policy.timeoutMs + BACKGROUND_QUEUE_GRACE_MS;

  // ── Start, or restart after a transient failure ──────────────────────────
  if (!job.responseId) {
    if (job.retryAt !== null && now < job.retryAt) return;
    if (!durable.canStartWork()) return;

    job.attempts += 1;
    job.attemptStartedAt = now;
    job.retryAt = null;

    try {
      const created = await createBackgroundResponse(await backgroundRequest(opts, resolved, policy));
      job.responseId = created.id;
      if (isTerminal(created.status)) settleFromResponse(job, created, opts, policy);
    } catch (err) {
      if (isTransientHttpError(err) && job.attempts < policy.maxRetries + 1) {
        job.retryAt = now + backoffMs(job.attempts);
      } else {
        failJob(job, describeError(err));
      }
    }
    return;
  }

  // ── Poll ─────────────────────────────────────────────────────────────────
  let response: ResponseObject;
  try {
    response = await retrieveResponse(job.responseId);
  } catch {
    // A failed poll is not a failed call — it is still running on OpenAI's side.
    // Try again next pass, unless it has outlived its deadline regardless.
    if (now - job.attemptStartedAt > deadlineMs) {
      await cancelResponse(job.responseId);
      failJob(job, 'timeout');
    }
    return;
  }

  if (!isTerminal(response.status)) {
    if (now - job.attemptStartedAt > deadlineMs) {
      await cancelResponse(job.responseId);
      failJob(job, 'timeout');
    }
    return;
  }

  settleFromResponse(job, response, opts, policy);
}

/**
 * Reads a finished response into the job. Validation is the same contract the
 * inline path gets from `generateObject`: the Zod schema, or a schema violation.
 */
function settleFromResponse<T>(
  job: DurableJob,
  response: ResponseObject,
  opts: RunAgentOptions<T>,
  policy: AgentPolicy,
): void {
  job.inputTokens = (job.inputTokens ?? 0) + (response.usage?.input_tokens ?? 0);
  job.outputTokens = (job.outputTokens ?? 0) + (response.usage?.output_tokens ?? 0);
  job.reasoningTokens =
    (job.reasoningTokens ?? 0) + (response.usage?.output_tokens_details?.reasoning_tokens ?? 0);

  if (response.status === 'completed') {
    const { text, refusal } = readOutput(response);
    if (!text) {
      failJob(job, refusal ? `refusal: ${refusal.slice(0, 200)}` : 'schema_violation');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      failJob(job, 'schema_violation');
      return;
    }

    const checked = opts.schema.safeParse(parsed);
    if (!checked.success) {
      failJob(job, 'schema_violation');
      return;
    }

    job.status = 'done';
    job.ok = true;
    job.data = checked.data;
    return;
  }

  if (response.status === 'failed') {
    const code = response.error?.code ?? 'failed';
    // Retried as a fresh call on a later pass, within the agent's retry budget.
    if (/server_error|rate_limit/i.test(code) && job.attempts < policy.maxRetries + 1) {
      job.responseId = null;
      job.retryAt = Date.now() + backoffMs(job.attempts);
      return;
    }
    failJob(job, `${code}: ${response.error?.message ?? ''}`.slice(0, 300));
    return;
  }

  if (response.status === 'incomplete') {
    // Almost always max_output_tokens: the reasoning ate the budget. Not
    // retried, for the same reason a schema violation is not — it will recur.
    failJob(job, `incomplete: ${response.incomplete_details?.reason ?? 'unknown'}`);
    return;
  }

  failJob(job, response.status === 'cancelled' ? 'cancelled' : `unexpected status ${response.status}`);
}

function failJob(job: DurableJob, error: string): void {
  job.status = 'failed';
  job.ok = false;
  job.error = error;
}

/** Written once, on the pass where the call settled — never on a replay. */
function recordSettledJob<T>(
  job: DurableJob,
  opts: RunAgentOptions<T>,
  resolved: ResolvedModel,
  policy: AgentPolicy,
): void {
  job.latencyMs = Date.now() - job.startedAt;
  job.costUsd = computeCostUsd(resolved.spec, job.inputTokens, job.outputTokens);

  recordAgentRun({
    agent: opts.agent,
    phase: policy.phase,
    provider: resolved.provider,
    model: resolved.modelId,
    latencyMs: job.latencyMs,
    inputTokens: job.inputTokens || undefined,
    outputTokens: job.outputTokens || undefined,
    costUsd: job.costUsd,
    ok: job.status === 'done',
    context: opts.context,
    meta: {
      ...opts.meta,
      attempts: job.attempts,
      tier: policy.tier,
      overridden: resolved.isOverridden,
      reasoning_effort: policy.reasoningEffort,
      reasoning_tokens: job.reasoningTokens || undefined,
      // Latency here is wall clock across passes, so it carries up to one poll
      // interval of slack on top of the model's own time.
      background: true,
      ...(job.status === 'failed' ? { error: job.error } : {}),
    },
  });
}

function replayDone<T>(job: DurableJob, opts: RunAgentOptions<T>): AgentRunResult<T> {
  return {
    ok: job.ok ?? true,
    data: job.data as T,
    fromFallback: job.fromFallback ?? false,
    meta: {
      agent: opts.agent,
      provider: job.provider,
      model: job.model,
      latencyMs: job.latencyMs ?? 0,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      reasoningTokens: job.reasoningTokens || undefined,
      costUsd: job.costUsd,
      attempts: job.attempts,
    },
  };
}

/** Exactly what the inline path does with a spent call: the fallback, or throw. */
function replayFailed<T>(job: DurableJob, opts: RunAgentOptions<T>): AgentRunResult<T> {
  const error = job.error ?? 'failed';
  if (opts.fallback) {
    return fallbackResult(opts.agent, opts.fallback, job.latencyMs ?? 0, error, {
      provider: job.provider,
      model: job.model,
      attempts: job.attempts,
    });
  }
  throw new AgentError(opts.agent, error);
}

/** A non-OpenAI call inside a pass: run in this request, once, and remembered. */
async function runInlineMemoised<T>(
  opts: RunAgentOptions<T>,
  resolved: ResolvedModel,
  durable: DurableContext,
  key: string,
): Promise<AgentRunResult<T>> {
  const started = Date.now();
  try {
    const result = await runInline(opts);
    durable.state.jobs[key] = {
      ...newJob(opts.agent, resolved, started),
      status: 'done',
      data: result.data,
      ok: result.ok,
      fromFallback: result.fromFallback,
      latencyMs: result.meta.latencyMs,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
      reasoningTokens: result.meta.reasoningTokens,
      costUsd: result.meta.costUsd,
      attempts: result.meta.attempts,
    };
    return result;
  } catch (err) {
    if (err instanceof AgentError) {
      durable.state.jobs[key] = {
        ...newJob(opts.agent, resolved, started),
        status: 'failed',
        ok: false,
        latencyMs: Date.now() - started,
        // AgentError prefixes the agent id; replayFailed puts it back.
        error: err.message.replace(/^\[[A-Z0-9]+\] /, ''),
      };
    }
    throw err;
  }
}

/**
 * The Responses API body for one background call — the same request
 * @ai-sdk/openai builds for `generateObject`, plus the background flag.
 */
async function backgroundRequest<T>(
  opts: RunAgentOptions<T>,
  resolved: ResolvedModel,
  policy: AgentPolicy,
): Promise<Record<string, unknown>> {
  const schema = await asSchema(opts.schema).jsonSchema;
  const effort = resolved.spec.supportsReasoningEffort
    ? resolveReasoningEffort(resolved.spec, policy.reasoningEffort)
    : undefined;

  return {
    model: resolved.modelId,
    instructions: opts.system,
    input: opts.prompt,
    max_output_tokens: effectiveMaxOutputTokens(resolved, policy),
    ...(resolved.spec.supportsTemperature && policy.temperature !== undefined
      ? { temperature: policy.temperature }
      : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    text: {
      // `name` and `strict` exactly as @ai-sdk/openai sends them, so the
      // strict-mode rules schemas.ts is written to still apply.
      format: { type: 'json_schema', name: 'response', strict: true, schema },
      ...(policy.textVerbosity ? { verbosity: policy.textVerbosity } : {}),
    },
    metadata: { agent: opts.agent },
  };
}
