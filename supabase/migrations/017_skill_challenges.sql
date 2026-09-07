-- ============================================================================
-- 017 · Skill challenges replace the system design module
--
-- Run AFTER 016. Every statement is idempotent.
--
-- The second module is no longer "system design". It is a hands-on task in a
-- technology the role actually requires — a React component, a SQL query
-- against a given schema, a broken function to find the fault in — and a system
-- design scenario is now just one of the shapes it can take, chosen when the
-- required skill genuinely is architecture.
--
-- The column is renamed rather than added-and-copied because the old shape has
-- no reader left: p7-challenge.ts writes the new v3 ChallengeSet and nothing
-- reads designChallengeSchema any more. A rename keeps the rows that are there,
-- which is all the old sessions need — their reports were generated at
-- evaluation time and do not read this column again.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sessions.design_challenge → sessions.skill_challenge
--
-- Guarded on both sides so this is safe to run twice, and safe to run on a
-- database provisioned from the current schema.sql (where the column is already
-- called skill_challenge and there is nothing to rename).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name = 'design_challenge'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name = 'skill_challenge'
  ) then
    alter table public.sessions rename column design_challenge to skill_challenge;
  end if;
end $$;

-- A database that never had the old column (a fresh provision from an older
-- schema.sql, or one where the rename already ran) still needs the column to
-- exist before session prep writes to it.
alter table public.sessions
  add column if not exists skill_challenge jsonb;

comment on column public.sessions.skill_challenge is
  'P7 skill-challenge set (v3): a hands-on task in a required technology — implement, debug, query or design. Validated after the interview by SV against the requirements stored here.';

-- ----------------------------------------------------------------------------
-- session_questions.skill_review
--
-- Where SV's reading of a submission lands: which requirements were met, what
-- the defects were, whether the planted bug was found. Its own column rather
-- than a key inside `grading` because `grading` is E4's contract — one agent's
-- output per column keeps the report able to say which reader said what, and
-- keeps a schema change to one of them from disturbing the other.
--
-- Null on every question that was not a skill submission, which is nearly all
-- of them.
-- ----------------------------------------------------------------------------
alter table public.session_questions
  add column if not exists skill_review jsonb;

comment on column public.session_questions.skill_review is
  'SV validation of a skill-challenge submission: per-requirement verdicts, defects, correctness and code quality. Null unless grading_mode = ''skill''.';
