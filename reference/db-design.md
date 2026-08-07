# DevTrackAcademy Interview — db-design.md

**Platform:** Supabase (Postgres 15+) for auth, database, storage, and realtime
**Shape:** 9 tables. Business identity and anything you sort/filter by lives in real columns; every AI artifact lives in a `jsonb` column.
**Goal:** one row read per screen.

---

## 1. Design rules

### 1.1 The column-vs-JSONB test

A field gets its own column if **any** of these is true:

- you filter, sort, or join on it (`user_id`, `company_name`, `status`, `overall_score`)
- it enforces a constraint (`credits_balance >= 0`, `unique(project_id, seq)`)
- it is a foreign key
- it is written by a different process than the rest of the object

Everything else goes in JSONB. That means `company_profile`, `jd_profile`, `gap_report`, `strategy`, `blueprint`, `report`, `rubric`, `speech_metrics` are each **one column**, not thirty tables.

### 1.2 Why big JSONB columns don't slow down your dashboard

Postgres TOASTs any value over ~2 KB: it stores it out-of-line in a side table and leaves a pointer in the main row. A `projects` row with 60 KB of AI artifacts still has a ~200-byte main tuple, and a query that doesn't name those columns never touches the TOAST table.

**This only holds if you don't `SELECT *`.** The dashboard query must list its columns explicitly. That single discipline is what makes the whole JSONB-heavy design fast.

```sql
-- fast: main tuple only, TOAST untouched
select id, company_name, role_title, readiness_overall, sessions_count from projects where user_id = $1;

-- slow: drags every artifact for every project across the wire
select * from projects where user_id = $1;
```

### 1.3 Generated columns: JSONB storage, column-speed reads

The one thing raw JSONB is bad at is sorting and filtering. Generated columns fix it — store the object once, project the hot scalar out as a real, indexable column that Postgres maintains for you:

```sql
overall_score numeric(4,1) generated always as ((scores->>'overall')::numeric) stored
```

You write `scores` as one object; you sort on `overall_score` with a plain btree index. No trigger, no duplicate write path, no drift.

> **Constraint:** the expression must be `IMMUTABLE`. Numeric and integer casts from text qualify. **`text::timestamptz` does not** — it depends on the session `TimeZone`. Keep timestamps as ordinary columns.

### 1.4 Denormalize what you'd otherwise aggregate

Two rollups are stored rather than computed, because both are read constantly and written rarely:

- `projects.stats` / `projects.readiness` — updated once at the end of each session, so the dashboard never aggregates over `sessions`.
- `skill_progress` — one row per project × skill, so the Gap Analysis page and the readiness trend never scan `session_questions`.

### 1.5 `user_id` on every table

Every row-level-security policy must be evaluable without a join. A policy like `using (project_id in (select id from projects where user_id = auth.uid()))` runs a subquery per row and will be the first thing to fall over under load. Carrying a redundant `user_id` on `sessions`, `session_questions`, and `skill_progress` is a few bytes per row that buys you flat, index-only policies everywhere.

### 1.6 What does not belong in Postgres

| Data | Where | Why |
|---|---|---|
| Per-turn live state (L2 memory, L3 coverage, turn counters) | **Redis** | Written 25× per interview at sub-second latency. Checkpoint to `sessions.live_state` every ~5 turns and once at the end |
| Word-level timestamp arrays | **Storage** (`transcripts/`) | ~2,000 words × 4 fields per session. Read once by E2, then effectively never. Keep the URL in `answer->>'words_url'` |
| Audio tracks | **Storage** (`audio/`) | Obvious |
| Pre-synthesized voice clips (P8) | **Storage** (`voice/`) | Index them in `sessions.voice_assets` |
| Resume PDFs | **Storage** (`resumes/`) | Path in `resumes.file_path` |

---

## 2. Entity map

```
auth.users (Supabase)
     │ 1:1
     ▼
  profiles ──────────────┬──────────────────┐
     │                   │                  │
     │ 1:N               │ 1:N              │ 1:N
     ▼                   ▼                  ▼
  projects          credit_ledger      agent_runs (ops)
     │
     ├──1:N──▶ resumes            (v1, v2, v3 … never overwritten)
     │            ▲
     │            └── projects.active_resume_id
     │
     ├──1:N──▶ skill_progress     (project × skill rollup)
     │
     └──1:N──▶ sessions
                   │
                   └──1:N──▶ session_questions

  company_cache    (shared across all users, keyed by domain — service role only)
```

**Nine tables.** `profiles`, `credit_ledger`, `projects`, `resumes`, `sessions`, `session_questions`, `skill_progress`, `company_cache`, `agent_runs`.

Everything the spec lists as a tab — Company, JD, Gap Analysis, ATS, Strategy — is a JSONB column on `projects` or `resumes`, not a table. They are written once, read together, and never queried into.

---

## 3. Schema

### 3.0 Extensions and enums

```sql
create extension if not exists pgcrypto;      -- gen_random_uuid()

create type project_status as enum ('draft','preparing','ready','failed','archived');
create type session_status as enum ('created','preparing','ready','live','processing','complete','failed','abandoned');
create type credit_kind   as enum ('purchase','grant','spend','refund','expiry');

-- shared updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
```

`session_status` mirrors the O1 orchestrator's state machine exactly. Keep them in lockstep — if the FSM gains a state, this enum gains a value.

---

### 3.1 `profiles`

```sql
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  avatar_url      text,
  org_id          uuid,                                    -- reserved for B2B/college accounts
  credits_balance integer not null default 0 check (credits_balance >= 0),
  prefs           jsonb  not null default '{}'::jsonb,
  onboarding      jsonb  not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
```

`prefs` holds language, TTS voice, interviewer persona, theme, default difficulty, default duration, notification settings — all read together when the app boots, none of them ever filtered on.

```json
{
  "language": "en-IN",
  "voice_id": "interviewer_warm_professional_en_IN",
  "persona": "warm_professional",
  "theme": "system",
  "defaults": { "difficulty": "medium", "duration_min": 15, "coding": true, "system_design": false }
}
```

**Auto-create on signup** so the app never has to handle a missing profile:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits_balance)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url',
          1)                              -- one free interview on signup
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

`org_id` is a nullable column you will not use for months. It costs nothing now and saves a migration on a live table when college accounts arrive.

---

### 3.2 `credit_ledger`

Append-only. `profiles.credits_balance` is the cached balance; this table is the audit trail and the two are written in the same transaction (§5.1).

```sql
create table public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          credit_kind not null,
  amount        integer not null,          -- positive = credit, negative = debit
  balance_after integer not null,
  session_id    uuid,                      -- set for 'spend' and 'refund'
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
```

`meta` carries whatever the row's `kind` needs — payment provider and order id for a purchase, or the cost breakdown for a spend:

```json
{ "breakdown": { "voice": 2, "coding": 1, "system_design": 0 }, "duration_min": 15, "difficulty": "medium" }
```

Never `update` this table. A correction is a new `refund` row.

---

### 3.3 `projects`

The workspace. One row is the entire Interview Project page.

```sql
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  org_id           uuid,

  -- identity: real columns, because the dashboard sorts and filters on them
  company_name     text not null,
  company_domain   text,
  company_logo_url text,
  role_title       text not null,
  seniority        text,
  status           project_status not null default 'draft',

  active_resume_id uuid,                    -- FK added after resumes exists
  jd_raw           text,                    -- pasted source, kept verbatim

  -- Phase 1 artifacts: written once, reused by every session in this project
  company_profile  jsonb,                   -- P1
  jd_profile       jsonb,                   -- P3
  gap_report       jsonb,                   -- P4
  strategy         jsonb,                   -- P5

  -- rollups: rewritten at the end of each session
  readiness        jsonb not null default '{}'::jsonb,
  stats            jsonb not null default '{}'::jsonb,

  -- projected scalars for sorting and dashboard tiles
  readiness_overall smallint generated always as
      (nullif(readiness->>'overall','')::smallint) stored,
  sessions_count    integer  generated always as
      (coalesce(nullif(stats->>'sessions_count','')::integer, 0)) stored,
  avg_score         numeric(4,1) generated always as
      (nullif(stats->>'avg_score','')::numeric) stored,

  last_session_at  timestamptz,             -- plain column: timestamptz casts are not IMMUTABLE
  prep_error       jsonb,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create index projects_user_idx on public.projects (user_id, updated_at desc)
  where deleted_at is null;
create index projects_domain_idx on public.projects (company_domain)
  where company_domain is not null;
```

**`readiness`** — the project-level score that evolves across sessions:

```json
{
  "overall": 77,
  "resume_match": 86,
  "technical": 74,
  "behavioral": 91,
  "coding": 68,
  "system_design": 42,
  "computed_at": "2026-08-07T09:22:00Z",
  "history": [
    { "session_id": "…", "overall": 62, "at": "2026-07-28" },
    { "session_id": "…", "overall": 71, "at": "2026-08-02" }
  ]
}
```

Cap `history` at the last 20 entries in the app when you write it. It is for a sparkline, not an archive — the full record is in `sessions`.

**`stats`** — everything the dashboard tile shows, so the tile query never aggregates:

```json
{ "sessions_count": 8, "avg_score": 74.2, "best_score": 86, "last_score": 81,
  "total_minutes": 118, "credits_spent": 24 }
```

**Soft delete.** `deleted_at` rather than a hard delete: sessions and reports are the user's practice history, and a mis-tapped delete that destroys eight interviews is not recoverable. Every index and RLS read filters on `deleted_at is null`.

---

### 3.4 `resumes`

Versioned, never overwritten — the spec is explicit about this and it is correct.

```sql
create table public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  version     integer not null,
  label       text,                            -- 'original', 'AI improved v2'
  source      text not null default 'upload',  -- upload | ai_improved
  file_path   text,                            -- storage: resumes/{user_id}/{id}.pdf
  parsed      jsonb,                           -- P2 output
  ats         jsonb,                           -- score, missing keywords, formatting, section quality
  suggestions jsonb,                           -- Resume Improvement Agent
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);

create index resumes_project_idx on public.resumes (project_id, version desc);

alter table public.projects
  add constraint projects_active_resume_fk
  foreign key (active_resume_id) references public.resumes(id) on delete set null;
```

`ats` example — one column, not eight:

```json
{ "score": 72, "keyword_coverage": 0.64,
  "missing_keywords": ["Kafka", "Terraform"],
  "formatting": { "score": 88, "issues": ["two-column layout may break parsers"] },
  "sections": { "experience": 80, "projects": 75, "achievements": 55 } }
```

The circular FK (`projects.active_resume_id` → `resumes.id` → `projects.id`) is fine because `active_resume_id` is nullable: insert the project, insert the resume, then update the pointer.

---

### 3.5 `sessions`

One attempt. Everything a session produces that is read as a whole lives here as JSONB; only per-question data is split out.

```sql
create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  resume_id        uuid references public.resumes(id) on delete set null,
  seq              integer not null,                   -- "Interview 3"
  status           session_status not null default 'created',

  config           jsonb not null default '{}'::jsonb, -- difficulty, modules, duration, language, focus_skills, persona
  blueprint        jsonb,                              -- P6: goals, banks, rubrics
  coding_challenge jsonb,                              -- P7: coding problem & tests
  design_challenge jsonb,                              -- P7: system design scenario & constraints
  voice_assets     jsonb,                              -- P8 index

  live_state       jsonb,                              -- checkpointed L2 memory + L3 coverage
  scores           jsonb,                              -- S1
  speech_summary   jsonb,                              -- E2 rollup
  report           jsonb,                              -- E6
  media            jsonb,                              -- audio + transcript storage paths

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

create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

create index sessions_project_idx on public.sessions (project_id, seq desc);
create index sessions_user_idx    on public.sessions (user_id, created_at desc);
create index sessions_active_idx  on public.sessions (status)
  where status in ('preparing','ready','live','processing');
```

`config` — what the user chose on the Start Interview screen:

```json
{ "difficulty": "medium", "duration_min": 15, "language": "en-IN",
  "modules": { "coding": true, "system_design": false, "behavioral": true },
  "focus_skills": ["PostgreSQL", "System Design"],
  "persona": "warm_professional" }
```

`media`:

```json
{ "candidate_audio": "audio/{user_id}/{session_id}/candidate.wav",
  "interviewer_audio": "audio/{user_id}/{session_id}/interviewer.wav",
  "words_url": "transcripts/{user_id}/{session_id}/words.json",
  "report_pdf": "reports/{user_id}/{session_id}.pdf" }
```

**`live_state` is a checkpoint, not the live store.** L2 and L3 run in Redis during the interview. Write a snapshot every ~5 turns and once on completion. If the browser dies at turn 14, the orchestrator resumes from the last checkpoint instead of losing the session — and Postgres never sees a per-turn write.

**The partial index on active statuses** is what your worker polls. It stays tiny regardless of how many completed sessions accumulate, because completed rows are not in it.

---

### 3.6 `session_questions`

The one thing that stays relational, for two concrete reasons:

1. **E4 grades questions in parallel.** Fifteen concurrent row inserts are trivial; fifteen concurrent `jsonb_set` calls on one array column is a lost-update bug waiting to happen.
2. **Cross-session analytics.** "Redis has come up in four interviews and scored under 6 every time" requires querying across questions, and that is the insight that makes the product sticky.

```sql
create table public.session_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  seq         integer not null,

  question    jsonb not null,        -- text, goal_id, intent, skill_tags, grading_mode, difficulty, rubric
  answer      jsonb,                 -- transcript, start_ms, end_ms, word_count, words_url
  metrics     jsonb,                 -- E2 speech metrics
  grading     jsonb,                 -- E3 evidence + E4 observations
  rewrite     jsonb,                 -- E5
  scores      jsonb,                 -- S1 per-question

  skill_tags   text[] not null default '{}',      -- written by the app; array ops need a real column
  grading_mode text,                              -- factual | experiential | behavioral | coding
  status       text not null default 'asked',

  accuracy    numeric(4,1) generated always as (nullif(scores->>'accuracy','')::numeric) stored,
  fluency     numeric(4,1) generated always as (nullif(scores->>'fluency','')::numeric) stored,

  created_at  timestamptz not null default now(),
  unique (session_id, seq)
);

create index sq_session_idx on public.session_questions (session_id, seq);
create index sq_skills_idx  on public.session_questions using gin (skill_tags);
create index sq_user_skill_idx on public.session_questions (user_id, created_at desc);
```

`skill_tags` is duplicated out of `question` as a real `text[]` because a GIN index on an array is the cheap way to answer "every question that touched Redis". A generated column can't build it — the expression needs a subquery — so the app writes both. That is the one intentional duplication in the schema.

**`answer` keeps the transcript, not the words.** Word-level timing goes to Storage:

```json
{ "transcript": "So, umm, I deployed our FastAPI service on a cluster…",
  "start_ms": 854200, "end_ms": 921450, "word_count": 142,
  "words_url": "transcripts/{session_id}/q_07.json",
  "asr_confidence_avg": 0.94, "interrupted": false }
```

---

### 3.7 `skill_progress`

The rollup that makes the Gap Analysis page a single indexed read instead of a scan over every question the user has ever answered.

```sql
create table public.skill_progress (
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  skill          text not null,
  jd_importance  numeric(3,2),
  status         text,                        -- STRONG | WEAK | UNVERIFIED | MISSING | SURPLUS
  score          numeric(4,1),
  confidence     numeric(3,2),
  depth          text,                        -- surface | working | implementation | design
  sessions_seen  integer not null default 0,
  history     Seeded from `gap_report` when the project is created (copying `jd_importance` and initial gap status), then upserted after every session from L3's coverage ledger:

```sql
insert into public.skill_progress (project_id, user_id, skill, status, score, confidence, depth, sessions_seen, history, jd_importance)
values ($1, $2, $3, $4, $5, $6, $7, 1, jsonb_build_array(jsonb_build_object('session_id',$8,'score',$5)), $9)
on conflict (project_id, skill) do update set
  status        = excluded.status,
  score         = excluded.score,
  confidence    = excluded.confidence,
  depth         = excluded.depth,
  jd_importance = coalesce(excluded.jd_importance, skill_progress.jd_importance),
  sessions_seen = skill_progress.sessions_seen + 1,
  history       = (skill_progress.history || excluded.history),
  updated_at    = now();
```

---

### 3.8 `company_cache`

Company research is the same for every user interviewing at the same company, and it is your most expensive prep call. Cache it globally.

```sql
create table public.company_cache (
  domain     text primary key,
  profile    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index company_cache_expiry_idx on public.company_cache (expires_at);
```

RLS is enabled with **no policies**, which denies all access to `anon` and `authenticated`. Only your server (service role) reads and writes it. Users never query this directly — the API checks the cache, and on a miss runs P1 and populates it.

---

### 3.9 `agent_runs`

Optional but build it on day one. It is how you answer "what does an interview actually cost" with data instead of arithmetic, and how you find the agent that regressed.

```sql
create table public.agent_runs (
  id            bigint generated always as identity primary key,
  user_id       uuid,
  project_id    uuid,
  session_id    uuid,
  agent         text not null,        -- 'P6', 'L1', 'E4'
  phase         text,                 -- prep | live | eval
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

create index agent_runs_session_idx on public.agent_runs (session_id);
create index agent_runs_agent_idx   on public.agent_runs (agent, created_at desc);
```

No FKs on purpose — logging must never fail because a parent row was deleted, and it must never take a lock on the tables serving user traffic.

Partition by month or prune with a cron job once it grows; it is the only table here with unbounded growth.

---

## 4. Row-level security

Every user-facing table is protected by one flat, join-free policy. Your backend agents use the **service role key**, which bypasses RLS entirely — so these policies only govern what the browser can reach.

```sql
alter table public.profiles          enable row level security;
alter table public.credit_ledger     enable row level security;
alter table public.projects          enable row level security;
alter table public.resumes           enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_questions enable row level security;
alter table public.skill_progress    enable row level security;
alter table public.company_cache     enable row level security;  -- no policies = service role only
alter table public.agent_runs        enable row level security;  -- no policies = service role only

-- profiles: read and update your own; inserts happen via the signup trigger
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- projects: full ownership
create policy projects_all on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- same shape for resumes, sessions, session_questions, skill_progress
create policy resumes_all on public.resumes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy sessions_all on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy session_questions_all on public.session_questions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy skill_progress_select on public.skill_progress
  for select to authenticated using (user_id = (select auth.uid()));

-- credits: read-only from the client. Balance changes only through the RPC in §5.1
create policy credit_ledger_select on public.credit_ledger
  for select to authenticated using (user_id = (select auth.uid()));
```

### Two details that matter more than they look

**`(select auth.uid())`, not `auth.uid()`.** Wrapping it in a subselect lets Postgres evaluate it once as an InitPlan instead of calling the function for every candidate row. On a table with a few thousand rows the difference is measurable; on `session_questions` it is large.

**`credits_balance` is not client-writable.** There is no update policy on it, and the only path that changes it is a `security definer` function. A client that could `update profiles set credits_balance = 9999` is a free product.

---

## 5. Functions

### 5.1 Spending credits atomically

```sql
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
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;

  -- the WHERE clause is the lock: the row is only debited if it can afford it
  update public.profiles
     set credits_balance = credits_balance - p_amount
   where id = v_uid and credits_balance >= p_amount
   returning credits_balance into v_bal;

  if v_bal is null then raise exception 'insufficient_credits'; end if;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
  values (v_uid, 'spend', -p_amount, v_bal, p_session, p_meta);

  return v_bal;
end $$;

revoke all on function public.spend_credits(integer, uuid, jsonb) from public;
grant execute on function public.spend_credits(integer, uuid, jsonb) to authenticated;
```

The conditional `UPDATE` is the whole concurrency story: Postgres takes a row lock, and two simultaneous "start interview" taps cannot both succeed on the last credit. No advisory locks, no serializable isolation, no application-level check-then-act race.

**Charge on session start, refund on failure.** If preparation fails or the voice session never connects, insert a `refund` row and add the credits back — same pattern, opposite sign.

### 5.2 Closing out a session

One call at the end of evaluation updates the session, the project rollups, and the skill ledger together, so the dashboard is never briefly inconsistent with the report.

```sql
create or replace function public.finalize_session(
  p_session_id uuid,
  p_scores     jsonb,
  p_report     jsonb,
  p_speech     jsonb,
  p_readiness  jsonb,
  p_skills     jsonb          -- [{skill, status, score, confidence, depth, jd_importance}, …]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_user    uuid;
begin
  update public.sessions
     set status = 'complete', scores = p_scores, report = p_report,
         speech_summary = p_speech, ended_at = now()
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

  insert into public.skill_progress (project_id, user_id, skill, status, score, confidence, depth, sessions_seen, history, jd_importance)
  select v_project, v_user,
         s->>'skill', s->>'status', (s->>'score')::numeric,
         (s->>'confidence')::numeric, s->>'depth', 1,
         jsonb_build_array(jsonb_build_object('session_id', p_session_id, 'score', (s->>'score')::numeric)),
         (s->>'jd_importance')::numeric
    from jsonb_array_elements(p_skills) s
  on conflict (project_id, skill) do update set
    status = excluded.status, score = excluded.score,
    confidence = excluded.confidence, depth = excluded.depth,
    jd_importance = coalesce(excluded.jd_importance, skill_progress.jd_importance),
    sessions_seen = skill_progress.sessions_seen + 1,
    history = skill_progress.history || excluded.history,
    updated_at = now();
end $$;
``` excluded.score,
    confidence = excluded.confidence, depth = excluded.depth,
    sessions_seen = skill_progress.sessions_seen + 1,
    history = skill_progress.history || excluded.history,
    updated_at = now();
end $$;
```

---

## 6. Query cookbook

Every screen in the spec is one round trip.

**Dashboard** — tiles plus the header counters:

```sql
select id, company_name, company_logo_url, role_title,
       readiness_overall, sessions_count, avg_score, last_session_at, status
  from projects
 where user_id = $1 and deleted_at is null
 order by updated_at desc;
```

Note what is absent: no join to `sessions`, no `count(*)`, no aggregate. The rollups are already in the row, and the four big artifact columns are never touched.

**Project Overview tab:**

```sql
select id, company_name, role_title, seniority, status, readiness, stats,
       gap_report, active_resume_id
  from projects where id = $1;
```

**Company / JD / Gap tabs** — name only the column that tab needs, so each tab pulls exactly one artifact:

```sql
select company_profile from projects where id = $1;   -- Company tab
select jd_profile      from projects where id = $1;   -- JD tab
select gap_report      from projects where id = $1;   -- Gap tab
```

**Gap Analysis with live progress (Claimed vs Verified)** — returns both initial P4 gap report (Claimed) and live skill progress (Verified) to render the full side-by-side gap matrix:

```sql
select p.gap_report,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'skill', sp.skill,
             'status', sp.status,
             'score', sp.score,
             'confidence', sp.confidence,
             'depth', sp.depth,
             'sessions_seen', sp.sessions_seen,
             'jd_importance', sp.jd_importance
           ) order by sp.jd_importance desc nulls last, sp.score asc
         ) filter (where sp.skill is not null), '[]'::jsonb
       ) as verified_skills
  from projects p
  left join skill_progress sp on sp.project_id = p.id
 where p.id = $1
 group by p.id;
```

**Interview History:**

```sql
select id, seq, status, overall_score, duration_sec, created_at,
       config->'modules' as modules
  from sessions
 where project_id = $1
 order by seq desc;
```

**Interview Report page** — two queries, and the second is only needed for the question-by-question section:

```sql
select report, scores, speech_summary, config, media from sessions where id = $1;

select seq, question->>'text' as question, answer->>'transcript' as answer,
       accuracy, fluency, grading, rewrite, metrics
  from session_questions
 where session_id = $1 order by seq;
```

**Cross-project weak-skill insight** — the query that earns the `skill_tags` GIN index:

```sql
select unnest(skill_tags) as skill, round(avg(accuracy), 1) as avg_accuracy, count(*) as times_asked
  from session_questions
 where user_id = $1 and accuracy is not null
 group by 1
having count(*) >= 2
 order by avg_accuracy asc
 limit 10;
```

**Cost per interview**, from `agent_runs`:

```sql
select session_id, round(sum(cost_usd), 4) as cost,
       sum(cost_usd) filter (where phase = 'prep') as prep,
       sum(cost_usd) filter (where phase = 'live') as live,
       sum(cost_usd) filter (where phase = 'eval') as eval
  from agent_runs where session_id = $1 group by 1;
```

---

## 7. Storage buckets

```
resumes/{user_id}/{resume_id}.pdf              private
audio/{user_id}/{session_id}/candidate.wav     private
audio/{user_id}/{session_id}/interviewer.wav   private
transcripts/{user_id}/{session_id}/words.json  private
transcripts/{user_id}/{session_id}/{question_id}.json private
voice/{user_id}/{session_id}/{asset_id}.wav    private, TTL 24h after session ends
voice/global/{pool}/{asset_id}.wav             private, permanent (shared acknowledgement pool)
reports/{user_id}/{session_id}.pdf             private, signed URL on download
```

All buckets private, all access through signed URLs. Carrying `{user_id}` as the top folder segment allows a single clean RLS policy to protect objects across user storage buckets:

```sql
create policy "own storage objects" on storage.objects for all to authenticated
  using ((storage.foldername(name))[1] = (select auth.uid())::text);
```

For session-scoped buckets, serve signed URLs from your API after checking ownership — cheaper and clearer than encoding the check in a storage policy.

**Delete `voice/{session_id}/` on a cron a day after the session ends.** Pre-synthesized clips are useless once the interview is over and will otherwise become your largest storage line item.

---

## 8. Realtime

The Processing screen should not poll. Subscribe to the session row:

```sql
alter publication supabase_realtime add table public.sessions;
```

```js
supabase.channel(`session:${id}`)
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${id}` },
      ({ new: row }) => setStage(row.status))
  .subscribe();
```

Realtime respects RLS, so a user only receives their own rows. Have the evaluation worker write intermediate progress into `sessions.error`'s sibling — add a small `progress jsonb` column if you want a per-agent progress bar — but don't add `session_questions` to the publication, or a 15-question grading run fires 15 client events for no benefit.

---

## 9. What deliberately isn't here

| Not a table | Where it lives | Why |
|---|---|---|
| Company Analysis | `projects.company_profile` | 1:1 with project, read whole, never queried into |
| Job Description | `projects.jd_profile` + `jd_raw` | Same |
| Gap Analysis | `projects.gap_report` + `skill_progress` | Static artifact plus a live rollup |
| ATS | `resumes.ats` | Belongs to a resume version, not a project |
| Strategy / Blueprint | `projects.strategy`, `sessions.blueprint` | Written once, read once, never filtered |
| Transcript | `session_questions.answer` + Storage | Segmented per question; word arrays out of the DB |
| Scores | `sessions.scores`, `session_questions.scores` | Read with their parent, always |
| Report | `sessions.report` | One blob, one reader |
| Coding submission | `sessions.report->'coding'` + `session_questions` row | Not enough rows to justify a table |
| Interview Memory (L2) | Redis, checkpointed to `sessions.live_state` | Per-turn writes must not hit Postgres |
| Evidence Coverage (L3) | Redis, same checkpoint | Same |

If any of these later needs to be filtered, sorted, or joined across sessions, promote **that one field** to a generated column. Do not promote the whole object to a table.

---

## 10. Migration order

```
001_extensions_enums_helpers.sql   pgcrypto, enums, touch_updated_at()
002_profiles.sql                   profiles + handle_new_user trigger
003_credits.sql                    credit_ledger + spend_credits()
004_projects.sql                   projects (without active_resume_id FK)
005_resumes.sql                    resumes + the deferred FK on projects
006_sessions.sql                   sessions
007_session_questions.sql          session_questions
008_skill_progress.sql             skill_progress + finalize_session()
009_shared.sql                     company_cache, agent_runs
010_rls.sql                        enable RLS + all policies
011_storage.sql                    buckets + storage policies
012_realtime.sql                   publication
```

Keep RLS in its own migration and apply it **before** the first real user exists, not after. Retro-fitting RLS to a table with live traffic means a window where either everything is exposed or everything is broken.

---

## 11. Things that will bite you later

| Issue | Do this now |
|---|---|
| `select *` on `projects` or `sessions` | Explicit column lists everywhere. Consider a `projects_summary` view with only the small columns and point the dashboard at it — then `select *` is safe by construction |
| JSONB shape drift as agents evolve | Put a `"v": 2` key at the top of every artifact object and branch on it when reading. Cheaper than a migration for a shape you'll change five more times |
| `readiness.history` growing forever | Cap at 20 entries on write |
| `agent_runs` growth | Prune or partition by month once past ~10M rows |
| Blanket GIN indexes on JSONB | Don't. Every GIN index taxes every write. `skill_progress` and the generated columns already answer the queries you actually have |
| Deleting a project | Soft delete only. `on delete cascade` from `projects` will take sessions, questions, and reports with it |
| Timestamps in generated columns | Not possible — `text::timestamptz` isn't IMMUTABLE. Keep them as plain columns |
| Balance drift between `profiles` and `credit_ledger` | A nightly job asserting `sum(amount) = credits_balance` per user. If it ever fails, you have a bug in a write path and you want to know that week, not that quarter |
