-- ============================================================================
-- 021 · pipeline_runs — resumable prep and evaluation
--
-- Run AFTER 020. Every statement is idempotent — safe to run twice.
--
-- AWS Amplify Hosting ends every request at 30 seconds, with no setting to
-- raise it. Project prep, the prep plan, session prep and evaluation each take
-- one to three minutes, and several single model calls inside them take longer
-- than thirty seconds on their own. So none of them runs inside one request any
-- more: the browser drives each pipeline forward with short POSTs, the long
-- model calls run as OpenAI background jobs, and this table is where a run
-- keeps its place between requests — which calls were started, which finished,
-- and what they returned. See lib/ai/durable.ts and lib/pipelines/pipeline-runs.ts.
--
-- One row per (kind, subject). Restarting a run overwrites it; a run's history
-- is `agent_runs`, not this table.
--
-- Service role only. RLS is on with no policies, the same arrangement as
-- company_cache and agent_runs: the browser never reads a run directly, it asks
-- the route that owns it.
-- ============================================================================

create table if not exists public.pipeline_runs (
  kind         text not null
               check (kind in ('project_prep', 'prep_plan', 'session_prep', 'evaluation')),
  -- projects.id for project_prep and prep_plan, sessions.id for the other two.
  -- No foreign key: it points into one of two tables depending on `kind`.
  subject_id   uuid not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'running'
               check (status in ('running', 'done', 'failed')),
  input        jsonb not null default '{}'::jsonb,
  -- { jobs: { <call key>: DurableJob }, memo: { <key>: value } }
  state        jsonb not null default '{}'::jsonb,
  progress     jsonb,
  result       jsonb,
  error        text,
  -- Optimistic lock. A request claims the run by bumping it and only the
  -- claimant's write lands, so two tabs polling the same run cannot both start
  -- the same model call.
  rev          integer not null default 0,
  -- Changes on every restart, so a pass still in flight from the previous run
  -- cannot overwrite the new one.
  generation   uuid not null default gen_random_uuid(),
  -- Held while a request is advancing the run. Expires on its own if that
  -- request is killed mid-pass, which on a 30-second host is not hypothetical.
  lease_until  timestamptz,
  passes       integer not null default 0,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (kind, subject_id)
);

drop trigger if exists pipeline_runs_touch on public.pipeline_runs;
create trigger pipeline_runs_touch before update on public.pipeline_runs
  for each row execute function public.touch_updated_at();

alter table public.pipeline_runs enable row level security;
revoke all on public.pipeline_runs from anon, authenticated;

comment on table public.pipeline_runs is
  'Resumable state for the prep and evaluation pipelines. Service role only. See lib/pipelines/pipeline-runs.ts.';
