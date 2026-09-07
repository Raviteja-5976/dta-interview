-- ============================================================================
-- 018 · Interview date and preparation plan
--
-- Run AFTER 017. Every statement is idempotent.
--
-- Two columns behind one feature: the candidate tells us when the interview is,
-- and we generate the resume they could honestly be sending, the projects worth
-- building first, and a timetable for the days that actually remain.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- projects.interview_date
--
-- A `date`, not a `timestamptz`, and deliberately.
--
-- What matters here is which calendar day the interview falls on, in the
-- candidate's own life. A timestamp would carry a timezone nobody supplied and
-- an hour nobody knows, and "days until" computed from it would shift by one for
-- anyone east or west of wherever the server happens to run.
--
-- Nullable: a project is perfectly usable without one, and most are created
-- before an interview is actually booked.
-- ----------------------------------------------------------------------------
alter table public.projects
  add column if not exists interview_date date;

comment on column public.projects.interview_date is
  'The day of the real interview, in the candidate''s calendar. Drives the preparation timetable. Null until they know it.';

-- ----------------------------------------------------------------------------
-- projects.prep_plan
--
-- The generated artifact: the rewritten resume (RI), the study plan and project
-- recommendations (SP), and the schedule with dates already resolved onto it.
--
-- Overwritten rather than versioned, unlike `resumes`. A resume version has a
-- meaningful delta against the one before it — that is what makes the ATS
-- comparison worth showing. A plan does not: it is derived from inputs that are
-- themselves stored, and an old plan built against a date that has since moved
-- is not history, it is simply wrong. The row records which resume and which
-- date it was built from so the page can tell the user when it has gone stale.
-- ----------------------------------------------------------------------------
alter table public.projects
  add column if not exists prep_plan jsonb;

comment on column public.projects.prep_plan is
  'Preparation plan (v3): ideal resume, projects to build, and a dated timetable. Regenerated on demand; carries the resume_id and interview_date it was built against.';

-- An index is deliberately NOT added on interview_date. Nothing queries by it —
-- the column is read alongside the project row it belongs to and never filtered
-- across projects. An index here would be write cost for no read.
