/**
 * The runner behind the four long pipelines — project prep, the prep plan,
 * session prep and evaluation.
 *
 * Each HTTP request is ONE PASS: load the run, claim it, execute the pipeline
 * inside a durable context (lib/ai/durable.ts), save what moved, release. The
 * browser keeps asking until the run is done or failed. Every pass is a few
 * seconds of real work, so none of them comes near Amplify's 30-second request
 * limit, however long the pipeline takes end to end.
 *
 * A run that nobody is polling is not lost. Its background calls keep running
 * on OpenAI's side and are still there to collect when the page is next opened
 * — the pipeline simply does not advance between polls.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DurableContext,
  isPendingWork,
  runInContext,
  type DurableProgress,
  type DurableState,
} from '../ai/durable';
import { cancelResponse } from '../ai/openai-background';

export type PipelineKind = 'project_prep' | 'prep_plan' | 'session_prep' | 'evaluation';

export interface PipelineRun {
  kind: PipelineKind;
  subject_id: string;
  user_id: string;
  status: 'running' | 'done' | 'failed';
  input: Record<string, unknown>;
  state: Partial<DurableState> | null;
  progress: DurableProgress | null;
  result: unknown;
  error: string | null;
  rev: number;
  generation: string;
  lease_until: string | null;
  passes: number;
}

/** What a pass reports when it gets all the way to the end. */
export interface PassOutcome {
  ok: boolean;
  error?: string | null;
  result?: unknown;
}

export interface RunSnapshot {
  status: PipelineRun['status'];
  progress: DurableProgress | null;
  result: unknown;
  error: string | null;
  /** True only on the pass that moved the run to done or failed. */
  settledNow: boolean;
}

const COLUMNS =
  'kind, subject_id, user_id, status, input, state, progress, result, error, rev, generation, lease_until, passes';

/**
 * How long a claim holds. Just under the host's request limit, so a pass that
 * was killed mid-flight has released its run by the time the next poll lands.
 */
const LEASE_MS = 28_000;

export async function loadRun(
  admin: SupabaseClient,
  kind: PipelineKind,
  subjectId: string,
): Promise<PipelineRun | null> {
  const { data } = await admin
    .from('pipeline_runs')
    .select(COLUMNS)
    .eq('kind', kind)
    .eq('subject_id', subjectId)
    .maybeSingle();

  return (data as PipelineRun | null) ?? null;
}

/**
 * Starts a run from scratch, replacing any earlier one for the same subject.
 *
 * Background calls the old run left running are cancelled on the way out —
 * they would otherwise run to completion and bill for results nothing reads.
 */
export async function startRun(
  admin: SupabaseClient,
  args: {
    kind: PipelineKind;
    subjectId: string;
    userId: string;
    input?: Record<string, unknown>;
    previous?: PipelineRun | null;
  },
): Promise<PipelineRun> {
  const orphaned = Object.values(args.previous?.state?.jobs ?? {}).filter(
    (job) => job.status === 'pending' && job.responseId,
  );
  await Promise.all(orphaned.map((job) => cancelResponse(job.responseId!)));

  const { data, error } = await admin
    .from('pipeline_runs')
    .upsert(
      {
        kind: args.kind,
        subject_id: args.subjectId,
        user_id: args.userId,
        status: 'running',
        input: args.input ?? {},
        state: { jobs: {}, memo: {} },
        progress: null,
        result: null,
        error: null,
        rev: 0,
        // A pass still in flight from the old run holds the old generation, so
        // its final write matches nothing and cannot clobber this one.
        generation: randomUUID(),
        lease_until: null,
        passes: 0,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'kind,subject_id' },
    )
    .select(COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not start the ${args.kind} run: ${error?.message ?? 'no row returned'}`);
  }

  return data as PipelineRun;
}

/**
 * Executes one pass of `run`, if nobody else is.
 *
 * `pass` is the pipeline itself, unchanged in shape: it runs top to bottom,
 * and every model call it makes resolves from the run's state, from a
 * background job that just finished, or with PendingWork. The pass that gets
 * through with nothing pending is the one whose outcome settles the run.
 */
export async function advanceRun(
  admin: SupabaseClient,
  run: PipelineRun,
  pass: () => Promise<PassOutcome>,
  hooks: { onProgress?: (progress: DurableProgress) => Promise<void> } = {},
): Promise<RunSnapshot> {
  const unchanged: RunSnapshot = {
    status: run.status,
    progress: run.progress,
    result: run.result,
    error: run.error,
    settledNow: false,
  };

  if (run.status !== 'running') return unchanged;

  // Another request is mid-pass. Report where things stand and let it finish.
  if (run.lease_until && Date.parse(run.lease_until) > Date.now()) return unchanged;

  const claimedRev = run.rev + 1;
  const { data: claimed } = await admin
    .from('pipeline_runs')
    .update({ rev: claimedRev, lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq('kind', run.kind)
    .eq('subject_id', run.subject_id)
    .eq('rev', run.rev)
    .eq('generation', run.generation)
    .select('rev');

  // Lost the race to another request that read the same row.
  if (!claimed?.length) return unchanged;

  const ctx = new DurableContext(run.state, run.progress);
  let outcome: PassOutcome | null = null;
  let thrown: unknown = null;

  try {
    outcome = await runInContext(ctx, pass);
  } catch (err) {
    thrown = err;
  }

  // Nothing is saved while a call this pass started is still recording its id.
  await ctx.settle();

  let status: PipelineRun['status'] = 'running';
  let result: unknown = null;
  let error: string | null = null;

  if (ctx.hasPending || isPendingWork(thrown)) {
    // Something is still running. Whatever the pass concluded, it concluded
    // from incomplete information — a fallback standing in for an unfinished
    // call, say — so its outcome is discarded. The next pass will get further.
  } else if (thrown) {
    status = 'failed';
    error = thrown instanceof Error ? thrown.message : 'The pipeline failed.';
    console.error(`[pipeline] ${run.kind} ${run.subject_id} failed`, thrown);
  } else if (outcome) {
    status = outcome.ok ? 'done' : 'failed';
    result = outcome.result ?? null;
    error = outcome.ok ? null : (outcome.error ?? 'The pipeline failed.');
  }

  const progress = ctx.progress;
  const progressMoved =
    progress !== null &&
    (progress.stage !== run.progress?.stage || progress.detail !== run.progress?.detail);

  if (progressMoved && hooks.onProgress) {
    // A missed progress write costs a UI update, never the run.
    await hooks.onProgress(progress).catch(() => undefined);
  }

  await admin
    .from('pipeline_runs')
    .update({
      state: ctx.state,
      progress,
      status,
      result,
      error,
      lease_until: null,
      passes: run.passes + 1,
    })
    .eq('kind', run.kind)
    .eq('subject_id', run.subject_id)
    .eq('rev', claimedRev)
    .eq('generation', run.generation);

  if (progressMoved || status !== 'running') {
    console.info(
      `[pipeline] ${run.kind} ${run.subject_id} → ${status}` +
        `${progress ? ` (${progress.stage})` : ''} after ${run.passes + 1} passes`,
    );
  }

  return { status, progress, result, error, settledNow: status !== 'running' };
}
