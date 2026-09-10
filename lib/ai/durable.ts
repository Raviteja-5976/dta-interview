/**
 * Durable execution — how a two-minute pipeline runs on a host that ends every
 * request at thirty seconds.
 *
 * ── The constraint ───────────────────────────────────────────────────────────
 * AWS Amplify Hosting gives an SSR request 30 seconds, hard, with no setting to
 * raise it, and nothing keeps running after the response is sent. Project prep,
 * the prep plan, session prep and evaluation all take one to three minutes, and
 * several single model calls inside them — P7 at high effort, the resume
 * rewrites — take longer than thirty seconds on their own. Splitting the work
 * into more requests cannot fix a call that is itself too long.
 *
 * ── What happens instead ─────────────────────────────────────────────────────
 * A pipeline runs as a series of short PASSES, each one its own request
 * (lib/pipelines/pipeline-runs.ts). Every pass executes the pipeline function
 * from the top, and every model call inside it goes through `runAgent`, which —
 * inside a pass — becomes a lookup:
 *
 *   finished in an earlier pass  → returns the stored result instantly
 *   running as a background job  → polls it; still going → PendingWork
 *   never started                → starts it as a background job → PendingWork
 *
 * So a pass walks the pipeline as far as the finished work reaches, starts or
 * checks whatever comes next, and stops. The next pass, a couple of seconds
 * later, gets further. The pass that finds every call finished is the one that
 * writes the result. The long calls themselves run on OpenAI's side in
 * background mode (openai-background.ts), so no request of ours waits on one.
 *
 * ── The rules a pipeline has to follow ───────────────────────────────────────
 *   1. Nothing irreversible before `checkpoint()`. A pass that ends in
 *      PendingWork is thrown away and run again, so its side effects repeat.
 *   2. Never swallow PendingWork. Every `catch` calls `rethrowIfPending` first.
 *   3. Parallel groups use `Promise.allSettled`, so every call in the group has
 *      been started or checked before the pass decides anything.
 *   4. Anything non-deterministic that feeds a prompt goes through `memo`, or
 *      the call's identity changes between passes and it is started twice.
 *
 * Outside a pass none of this is active — the live turn loop calls `runAgent`
 * exactly as it always has.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentId, ProviderId } from './types';

/** One model call's life across passes. Serialised into `pipeline_runs.state`. */
export interface DurableJob {
  agent: AgentId;
  provider: ProviderId;
  model: string;
  status: 'pending' | 'done' | 'failed';
  /** The OpenAI response id while the call runs in background mode. */
  responseId: string | null;
  /** First attempt, ms since epoch. Latency is measured from here. */
  startedAt: number;
  /** The current attempt, which its deadline is measured from. */
  attemptStartedAt: number;
  attempts: number;
  /** Set when creating the call failed transiently; the retry waits for it. */
  retryAt: number | null;
  /** The validated output, once done. */
  data?: unknown;
  ok?: boolean;
  fromFallback?: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  error?: string;
}

export interface DurableState {
  jobs: Record<string, DurableJob>;
  memo: Record<string, unknown>;
}

export interface DurableProgress {
  stage: string;
  detail: string | null;
}

/**
 * Thrown when a pass reaches work that has not finished yet.
 *
 * Not a failure in any sense that matters: it is how a pass says "this is as
 * far as I can get right now". The runner catches it and saves the pass; the
 * browser's next poll is the next pass.
 */
export class PendingWork extends Error {
  constructor() {
    super('Waiting on work that has not finished yet.');
    this.name = 'PendingWork';
  }
}

export function isPendingWork(err: unknown): err is PendingWork {
  return err instanceof PendingWork || (err instanceof Error && err.name === 'PendingWork');
}

/**
 * How far into a pass new background calls may still be started.
 *
 * Starting one is a single short request, but a pass that keeps starting them
 * up to the 30-second wall is a pass that gets killed holding job ids it never
 * saved. Past this point it only polls what it already has, and leaves the rest
 * to the next pass.
 */
const START_BUDGET_MS = 12_000;

export class DurableContext {
  readonly state: DurableState;
  progress: DurableProgress | null;

  private readonly startedAt = Date.now();
  private pending = 0;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(state: Partial<DurableState> | null | undefined, progress: DurableProgress | null) {
    this.state = { jobs: { ...(state?.jobs ?? {}) }, memo: { ...(state?.memo ?? {}) } };
    this.progress = progress;
  }

  /** True once anything this pass touched is still waiting on unfinished work. */
  get hasPending(): boolean {
    return this.pending > 0;
  }

  markPending(): void {
    this.pending += 1;
  }

  canStartWork(): boolean {
    return Date.now() - this.startedAt < START_BUDGET_MS;
  }

  /**
   * Registers work the pass must not be saved without. A job that was created
   * but whose id was never recorded is a call that runs, bills, and is then
   * started all over again by the next pass.
   */
  track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    const release = () => {
      this.inflight.delete(work);
    };
    work.then(release, release);
    return work;
  }

  /**
   * Waits until nothing tracked is still running.
   *
   * A `Promise.all` inside a pipeline rejects on its first PendingWork and
   * leaves its siblings running; this is what stops the pass from being saved
   * while they are still writing job ids into the state. The macrotask hop at
   * the top of each round lets the continuations of just-settled work run first,
   * so a call one of them starts is registered before the set is checked again.
   */
  async settle(): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.inflight.size === 0) return;
      await Promise.allSettled([...this.inflight]);
    }
  }
}

const storage = new AsyncLocalStorage<DurableContext>();

/** Runs one pass with `ctx` as the ambient durable context. */
export function runInContext<T>(ctx: DurableContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The ambient context, or undefined outside a pipeline pass. */
export function currentDurableContext(): DurableContext | undefined {
  return storage.getStore();
}

/**
 * Stops the pass if anything it has touched so far is still running.
 *
 * Call it before every side effect, and before any decision that reads a
 * group's results — a `.catch()` or `allSettled` upstream may have turned an
 * unfinished call into a null that looks exactly like a failure.
 *
 * A no-op outside a pass.
 */
export function checkpoint(): void {
  if (storage.getStore()?.hasPending) throw new PendingWork();
}

/** The first line of every `catch` in a pipeline. */
export function rethrowIfPending(err: unknown): void {
  if (isPendingWork(err)) throw err;
}

/** For code that collects a group with `allSettled` and then picks through it. */
export function throwIfAnyPending(results: PromiseSettledResult<unknown>[]): void {
  if (results.some((r) => r.status === 'rejected' && isPendingWork(r.reason))) {
    throw new PendingWork();
  }
}

/**
 * Records how far the pipeline has got. The last call in a pass wins, which is
 * the furthest stage that pass reached. A no-op outside a pass.
 */
export function reportProgress(stage: string, detail?: string | null): void {
  const ctx = storage.getStore();
  if (ctx) ctx.progress = { stage, detail: detail ?? null };
}

/**
 * Computes a value once per run and replays it on every later pass.
 *
 * For anything that feeds a prompt and could come out differently the second
 * time: a scraped web page, a table another request might write to. A prompt
 * that changes between passes gives its call a new identity, and the call is
 * started again from nothing.
 *
 * Only a value the function actually returned is kept — one that ended in
 * PendingWork runs again next pass. The value must survive JSON; `undefined`
 * comes back as `null`. Outside a pass this simply calls the function.
 */
export async function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return fn();

  if (Object.prototype.hasOwnProperty.call(ctx.state.memo, key)) {
    return ctx.state.memo[key] as T;
  }

  const value = await ctx.track(fn());
  ctx.state.memo[key] = value === undefined ? null : value;
  return value;
}
