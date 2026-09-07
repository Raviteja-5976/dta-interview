-- ============================================================================
-- DevTrackAcademy Interview Platform — Complete Supabase Database Schema
-- Standard: Supabase Postgres 15+
-- Direct execution compatible: Copy and paste directly into Supabase SQL Editor
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS & ENUMS
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

do $$ begin
  create type public.project_status as enum ('draft','preparing','ready','failed','archived');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.session_status as enum ('created','preparing','ready','live','processing','complete','failed','abandoned');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.credit_kind as enum ('purchase','grant','spend','refund','expiry');
exception
  when duplicate_object then null;
end $$;

-- Shared updated_at timestamp trigger function
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES & INDEXES
-- ----------------------------------------------------------------------------

-- 2.1 Profiles
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  avatar_url      text,
  org_id          uuid,
  credits_balance integer not null default 0 check (credits_balance >= 0),
  prefs           jsonb  not null default '{}'::jsonb,
  onboarding      jsonb  not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Auto-create profile trigger on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits_balance)
  values (
    new.id, 
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    1 -- 1 free credit on signup
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created 
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2.2 Credit Ledger
create table if not exists public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          public.credit_kind not null,
  amount        integer not null,
  balance_after integer not null,
  session_id    uuid,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);


-- 2.3 Projects
create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  org_id           uuid,

  company_name     text not null,
  company_domain   text,
  company_logo_url text,
  role_title       text not null,
  seniority        text,
  status           public.project_status not null default 'draft',

  active_resume_id uuid,
  jd_raw           text,

  company_profile  jsonb,
  jd_profile       jsonb,
  gap_report       jsonb,
  strategy         jsonb,

  -- The day of the real interview, in the candidate's own calendar. A `date`
  -- rather than a timestamp: only the calendar day matters, and a timestamp
  -- would carry a timezone nobody supplied.
  interview_date   date,
  -- Ideal resume, projects worth building, and the dated timetable. See 018.
  prep_plan        jsonb,

  readiness        jsonb not null default '{}'::jsonb,
  stats            jsonb not null default '{}'::jsonb,

  readiness_overall smallint generated always as
      (nullif(readiness->>'overall','')::smallint) stored,
  sessions_count    integer generated always as
      (coalesce(nullif(stats->>'sessions_count','')::integer, 0)) stored,
  avg_score         numeric(4,1) generated always as
      (nullif(stats->>'avg_score','')::numeric) stored,

  last_session_at  timestamptz,
  prep_error       jsonb,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc)
  where deleted_at is null;
create index if not exists projects_domain_idx on public.projects (company_domain)
  where company_domain is not null;


-- 2.4 Resumes
create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  version     integer not null,
  label       text,
  source      text not null default 'upload',
  file_path   text,
  parsed      jsonb,
  ats         jsonb,
  suggestions jsonb,
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists resumes_project_idx on public.resumes (project_id, version desc);

-- Circular FK for active_resume_id on projects
do $$ begin
  alter table public.projects
    add constraint projects_active_resume_fk
    foreign key (active_resume_id) references public.resumes(id) on delete set null;
exception
  when duplicate_object then null;
end $$;


-- 2.5 Sessions
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  resume_id        uuid references public.resumes(id) on delete set null,
  seq              integer not null,
  status           public.session_status not null default 'created',

  config           jsonb not null default '{}'::jsonb,
  blueprint        jsonb,
  coding_challenge jsonb,
  skill_challenge  jsonb,
  voice_assets     jsonb,

  live_state       jsonb,
  scores           jsonb,
  speech_summary   jsonb,
  report           jsonb,
  media            jsonb,

  credits_charged  integer not null default 0,
  error            jsonb,

  overall_score    numeric(4,1) generated always as (nullif(scores->>'overall','')::numeric) stored,
  duration_sec     integer,

  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, seq)
);

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

create index if not exists sessions_project_idx on public.sessions (project_id, seq desc);
create index if not exists sessions_user_idx    on public.sessions (user_id, created_at desc);
create index if not exists sessions_active_idx  on public.sessions (status)
  where status in ('preparing','ready','live','processing');


-- 2.6 Session Questions
create table if not exists public.session_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  seq         integer not null,

  question    jsonb not null,
  answer      jsonb,
  metrics     jsonb,
  grading     jsonb,
  rewrite     jsonb,
  scores      jsonb,
  -- SV's review of a skill-challenge submission. Null on every other question.
  skill_review jsonb,

  skill_tags   text[] not null default '{}',
  grading_mode text,
  status       text not null default 'asked',

  accuracy    numeric(4,1) generated always as (nullif(scores->>'accuracy','')::numeric) stored,
  fluency     numeric(4,1) generated always as (nullif(scores->>'fluency','')::numeric) stored,

  created_at  timestamptz not null default now(),
  unique (session_id, seq)
);

create index if not exists sq_session_idx on public.session_questions (session_id, seq);
create index if not exists sq_skills_idx  on public.session_questions using gin (skill_tags);
create index if not exists sq_user_skill_idx on public.session_questions (user_id, created_at desc);


-- 2.7 Skill Progress
create table if not exists public.skill_progress (
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  skill          text not null,
  jd_importance  numeric(3,2),
  status         text,
  score          numeric(4,1),
  confidence     numeric(3,2),
  depth          text,
  sessions_seen  integer not null default 0,
  history        jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (project_id, skill)
);

create index if not exists skill_progress_user_idx on public.skill_progress (user_id, score);


-- 2.8 Company Cache
create table if not exists public.company_cache (
  domain     text primary key,
  profile    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists company_cache_expiry_idx on public.company_cache (expires_at);


-- 2.9 Agent Runs (Ops logging)
create table if not exists public.agent_runs (
  id            bigint generated always as identity primary key,
  user_id       uuid,
  project_id    uuid,
  session_id    uuid,
  agent         text not null,
  phase         text,
  model         text,
  latency_ms    integer,
  input_tokens  integer,
  output_tokens integer,
  audio_sec     numeric(8,2),
  cost_usd      numeric(10,6),
  ok            boolean not null default true,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists agent_runs_session_idx on public.agent_runs (session_id);
create index if not exists agent_runs_agent_idx   on public.agent_runs (agent, created_at desc);


-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.credit_ledger     enable row level security;
alter table public.projects          enable row level security;
alter table public.resumes           enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_questions enable row level security;
alter table public.skill_progress    enable row level security;
alter table public.company_cache     enable row level security; -- Service role only
alter table public.agent_runs        enable row level security; -- Service role only

-- RLS Policies
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists projects_all on public.projects;
create policy projects_all on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists resumes_all on public.resumes;
create policy resumes_all on public.resumes
  for all to authenticated
  using (user_id = (select auth.uid())) 
  with check (user_id = (select auth.uid()));

drop policy if exists sessions_all on public.sessions;
create policy sessions_all on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid())) 
  with check (user_id = (select auth.uid()));

drop policy if exists session_questions_all on public.session_questions;
create policy session_questions_all on public.session_questions
  for all to authenticated
  using (user_id = (select auth.uid())) 
  with check (user_id = (select auth.uid()));

drop policy if exists skill_progress_select on public.skill_progress;
create policy skill_progress_select on public.skill_progress
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select to authenticated using (user_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- 4. STORED PROCEDURES & RPC FUNCTIONS
-- ----------------------------------------------------------------------------

-- 4.1 Spend credits atomically
create or replace function public.spend_credits(
  p_amount  integer,
  p_session uuid,
  p_meta    jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_bal integer;
begin
  if v_uid is null then 
    raise exception 'not_authenticated'; 
  end if;
  if p_amount <= 0 then 
    raise exception 'invalid_amount'; 
  end if;

  update public.profiles
     set credits_balance = credits_balance - p_amount
   where id = v_uid and credits_balance >= p_amount
   returning credits_balance into v_bal;

  if v_bal is null then 
    raise exception 'insufficient_credits'; 
  end if;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
  values (v_uid, 'spend', -p_amount, v_bal, p_session, p_meta);

  return v_bal;
end $$;

revoke all on function public.spend_credits(integer, uuid, jsonb) from public;
grant execute on function public.spend_credits(integer, uuid, jsonb) to authenticated;


-- 4.2 Finalize session on evaluation completion
create or replace function public.finalize_session(
  p_session_id uuid,
  p_scores     jsonb,
  p_report     jsonb,
  p_speech     jsonb,
  p_readiness  jsonb,
  p_skills     jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_user    uuid;
begin
  update public.sessions
     set status = 'complete', 
         scores = p_scores, 
         report = p_report,
         speech_summary = p_speech, 
         ended_at = now()
   where id = p_session_id
   returning project_id, user_id into v_project, v_user;

  update public.projects p
     set readiness = p_readiness,
         stats = jsonb_build_object(
           'sessions_count', coalesce((p.stats->>'sessions_count')::int, 0) + 1,
           'avg_score',      (select round(avg(overall_score), 1) from public.sessions
                                where project_id = v_project and status = 'complete'),
           'best_score',     (select max(overall_score) from public.sessions
                                where project_id = v_project and status = 'complete'),
           'last_score',     (p_scores->>'overall')::numeric
         ),
         last_session_at = now()
   where p.id = v_project;

  insert into public.skill_progress (
    project_id, user_id, skill, status, score, 
    confidence, depth, sessions_seen, history, jd_importance
  )
  select v_project, v_user,
         s->>'skill', 
         s->>'status', 
         (s->>'score')::numeric,
         (s->>'confidence')::numeric, 
         s->>'depth', 
         1,
         jsonb_build_array(jsonb_build_object('session_id', p_session_id, 'score', (s->>'score')::numeric)),
         (s->>'jd_importance')::numeric
    from jsonb_array_elements(p_skills) s
  on conflict (project_id, skill) do update set
    status        = excluded.status, 
    score         = excluded.score,
    confidence    = excluded.confidence, 
    depth         = excluded.depth,
    jd_importance = coalesce(excluded.jd_importance, skill_progress.jd_importance),
    sessions_seen = skill_progress.sessions_seen + 1,
    history       = skill_progress.history || excluded.history,
    updated_at    = now();
end $$;

revoke all on function public.finalize_session(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.finalize_session(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_session(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 5. STORAGE BUCKETS & STORAGE RLS POLICIES
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values 
  ('resumes', 'resumes', false),
  ('audio', 'audio', false),
  ('transcripts', 'transcripts', false),
  ('voice', 'voice', false),
  ('reports', 'reports', false)
on conflict (id) do nothing;

drop policy if exists "own storage objects" on storage.objects;
create policy "own storage objects" on storage.objects 
  for all to authenticated
  using ((storage.foldername(name))[1] = (select auth.uid())::text)
  with check ((storage.foldername(name))[1] = (select auth.uid())::text);
