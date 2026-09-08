-- ============================================================================
-- 020 · Roles, admin console, post-interview feedback, promo codes
--
-- Run AFTER 019. Every statement is idempotent — safe to run twice.
--
-- Four things arrive together because they depend on each other: the admin
-- console needs a role to gate on, the role needs a privilege fix to be worth
-- anything, and the console's reason for existing is the feedback and the promo
-- codes it manages.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. profiles.role
--
-- Everyone is a student. Admin is set by hand in the Supabase table editor —
-- there is deliberately no path from inside the app that can promote anyone,
-- because a self-serve one is a self-serve way to give yourself free credits.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('student','admin');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'student';

comment on column public.profiles.role is
  'student by default. Promote to admin manually in Supabase — nothing in the app can write this column.';

-- The admin user list sorts newest-first and nothing else does.
create index if not exists profiles_created_idx on public.profiles (created_at desc);


-- ----------------------------------------------------------------------------
-- 2. Column-level UPDATE grant on profiles          ** SECURITY — READ THIS **
--
-- `profiles_update` (schema.sql §RLS) is `using (id = auth.uid())` with no
-- column restriction, and Supabase grants UPDATE on public tables to
-- `authenticated` by default. So today any signed-in user can run
--
--     supabase.from('profiles').update({ credits_balance: 999999 })
--
-- against their own row and RLS waves it through — it IS their row. Every other
-- credit path is locked down (spend_credits goes through auth.uid(),
-- credit_purchase is service-role only, the payments table is read-only from the
-- browser) and this one policy walks around all of it.
--
-- Adding `role` makes it worse: the same call sets role='admin'.
--
-- Column grants are checked IN ADDITION to RLS, so naming the writable columns
-- closes both holes without touching the policy. `updated_at` is in the list
-- because lib/supabase/db.ts sends it explicitly; the profiles_touch trigger
-- overwrites whatever arrives, so granting it concedes nothing.
--
-- NOT in the list, and that is the entire point: credits_balance and role.
-- org_id stays because the profile page writes it today.
-- ----------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

grant update (full_name, avatar_url, org_id, prefs, onboarding, updated_at)
  on public.profiles to authenticated;


-- ----------------------------------------------------------------------------
-- 3. session_feedback
--
-- One row per session: how the interview felt, which no score can tell us.
-- `unique (session_id)` rather than a plain FK — the card on the report page
-- upserts, so a second submission edits the first instead of stacking.
-- ----------------------------------------------------------------------------
create table if not exists public.session_feedback (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null unique references public.sessions(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,

  -- 1-5. Required: a feedback row with no rating is a row that answers nothing.
  rating          smallint not null check (rating between 1 and 5),
  would_recommend boolean,
  -- Capped so a paste of an entire transcript cannot land here.
  improvement     text check (improvement is null or char_length(improvement) <= 2000),

  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists session_feedback_touch on public.session_feedback;
create trigger session_feedback_touch before update on public.session_feedback
  for each row execute function public.touch_updated_at();

create index if not exists session_feedback_created_idx on public.session_feedback (created_at desc);
create index if not exists session_feedback_user_idx    on public.session_feedback (user_id);

alter table public.session_feedback enable row level security;

-- Own rows only, AND only against a session that is actually theirs. The second
-- half matters: without it a user could file feedback under their own user_id
-- pointing at a stranger's session.
drop policy if exists session_feedback_own on public.session_feedback;
create policy session_feedback_own on public.session_feedback
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
       where s.id = session_id and s.user_id = (select auth.uid())
    )
  );


-- ----------------------------------------------------------------------------
-- 4. promo_codes / promo_redemptions
--
-- A code on a slide beats granting credits by hand: at a workshop everyone signs
-- up inside the same ten minutes, and you cannot grant to an account that does
-- not exist yet.
--
-- The real control is `max_redemptions` + `expires_at`, not per-user
-- uniqueness — someone will paste the code into a group chat, and a second
-- Google account defeats uniqueness in thirty seconds. The cap does not care.
--
-- RLS is on with NO policies on either table: they are reachable only through
-- the service role and through redeem_promo_code() below. A client that can read
-- promo_codes is a client that can read every unused code.
-- ----------------------------------------------------------------------------
create table if not exists public.promo_codes (
  -- Stored uppercase so 'dtaworkshop' and 'DTAWorkshop' are the same code.
  code            text primary key
                    check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  credits         integer not null check (credits > 0),

  -- null = uncapped. Set it. An uncapped code is an uncapped liability.
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeemed_count  integer not null default 0,

  -- null = never expires.
  expires_at      timestamptz,
  active          boolean not null default true,

  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.promo_redemptions (
  id         bigint generated always as identity primary key,
  code       text not null references public.promo_codes(code) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  credits    integer not null,
  created_at timestamptz not null default now(),
  -- The once-per-user guarantee, enforced by the database rather than by a check
  -- the RPC could race against itself on.
  unique (code, user_id)
);

create index if not exists promo_redemptions_user_idx on public.promo_redemptions (user_id, created_at desc);
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code, created_at desc);

alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;


-- ----------------------------------------------------------------------------
-- 5. grant_credits()
--
-- The single primitive that can create credits from nothing. Both the admin
-- console and redeem_promo_code() go through it, so there is exactly one place
-- where the balance and the ledger could ever disagree — and it is this one,
-- where they cannot.
--
-- Service role only, for the same reason refund_credits is (014 §4): a
-- client-callable grant is a free product.
-- ----------------------------------------------------------------------------
create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text default 'admin_grant',
  p_meta    jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  update public.profiles
     set credits_balance = credits_balance + p_amount
   where id = p_user_id
   returning credits_balance into v_bal;

  if v_bal is null then
    raise exception 'user_not_found';
  end if;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, meta)
  values (p_user_id, 'grant', p_amount, v_bal,
          p_meta || jsonb_build_object('reason', p_reason));

  return v_bal;
end $$;

revoke all on function public.grant_credits(uuid, integer, text, jsonb) from public;
revoke all on function public.grant_credits(uuid, integer, text, jsonb) from authenticated;
grant execute on function public.grant_credits(uuid, integer, text, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 6. redeem_promo_code()
--
-- Callable by any signed-in user; reads auth.uid() itself and never trusts a
-- user id from the caller.
--
-- `for update` on the code row is what makes the cap real: sixty students in a
-- lecture hall all submit within the same few seconds, and without the lock
-- `redeemed_count >= max_redemptions` is a read-then-write race that overshoots.
-- They queue on the row instead.
--
-- Returns jsonb rather than raising, because every failure here is a thing a
-- human needs told in words — expired, already used, all claimed — and parsing
-- Postgres error strings on the client to say so is worse.
-- ----------------------------------------------------------------------------
create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := (select auth.uid());
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes%rowtype;
  v_bal  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated',
                              'message', 'You need to be signed in to use a code.');
  end if;

  if v_norm = '' then
    return jsonb_build_object('ok', false, 'error', 'unknown',
                              'message', 'Enter a code first.');
  end if;

  select * into v_code from public.promo_codes where code = v_norm for update;

  -- Deliberately the same wording for "no such code" as for a deactivated one:
  -- distinguishing them turns this into an oracle for guessing live codes.
  if not found or not v_code.active then
    return jsonb_build_object('ok', false, 'error', 'unknown',
                              'message', 'That code is not valid.');
  end if;

  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired',
                              'message', 'That code has expired.');
  end if;

  if v_code.max_redemptions is not null and v_code.redeemed_count >= v_code.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'exhausted',
                              'message', 'This code has been fully claimed.');
  end if;

  if exists (select 1 from public.promo_redemptions where code = v_norm and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed',
                              'message', 'You have already used this code.');
  end if;

  insert into public.promo_redemptions (code, user_id, credits)
  values (v_norm, v_uid, v_code.credits);

  update public.promo_codes
     set redeemed_count = redeemed_count + 1
   where code = v_norm;

  update public.profiles
     set credits_balance = credits_balance + v_code.credits
   where id = v_uid
   returning credits_balance into v_bal;

  -- Tagged with the code so "did the workshop cohort come back and pay?" is a
  -- query rather than a guess.
  insert into public.credit_ledger (user_id, kind, amount, balance_after, meta)
  values (v_uid, 'grant', v_code.credits, v_bal,
          jsonb_build_object('reason', 'promo_code', 'code', v_norm));

  return jsonb_build_object('ok', true, 'code', v_norm,
                            'credits', v_code.credits, 'balance', v_bal);
exception
  -- The unique (code, user_id) index, reached by two tabs at once.
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed',
                              'message', 'You have already used this code.');
end $$;

revoke all on function public.redeem_promo_code(text) from public;
grant execute on function public.redeem_promo_code(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. admin_user_overview
--
-- One row per user with everything the console shows. A view rather than five
-- queries per row in the route handler, which is the difference between one
-- round trip and N+1 of them.
--
-- security_invoker so it carries no privilege of its own: the console reaches it
-- with the service role (which bypasses RLS anyway), and if the grant below is
-- ever loosened by accident a normal user still sees only their own row rather
-- than the whole table.
-- ----------------------------------------------------------------------------
drop view if exists public.admin_user_overview;

create view public.admin_user_overview
with (security_invoker = on) as
select
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.credits_balance,
  p.created_at,

  coalesce(s.interviews_completed, 0) as interviews_completed,
  coalesce(s.interviews_started, 0)   as interviews_started,
  s.last_interview_at,

  -- Only graded questions count. One that was generated but never reached tells
  -- you nothing about what the candidate actually did.
  coalesce(q.coding_questions, 0)     as coding_questions,
  coalesce(q.skill_questions, 0)      as skill_questions,

  coalesce(l.credits_purchased, 0)    as credits_purchased,
  coalesce(l.credits_granted, 0)      as credits_granted,
  coalesce(l.credits_spent, 0)        as credits_spent,
  coalesce(pay.paid_paise, 0)         as paid_paise,

  coalesce(f.feedback_count, 0)       as feedback_count,
  f.avg_rating
from public.profiles p

left join lateral (
  select count(*) filter (where status = 'complete') as interviews_completed,
         count(*)                                    as interviews_started,
         max(ended_at)                               as last_interview_at
    from public.sessions where user_id = p.id
) s on true

left join lateral (
  select count(*) filter (where grading_mode = 'coding' and status = 'graded') as coding_questions,
         count(*) filter (where grading_mode = 'skill'  and status = 'graded') as skill_questions
    from public.session_questions where user_id = p.id
) q on true

left join lateral (
  select coalesce(sum(amount) filter (where kind = 'purchase'), 0) as credits_purchased,
         coalesce(sum(amount) filter (where kind = 'grant'), 0)    as credits_granted,
         coalesce(-sum(amount) filter (where kind = 'spend'), 0)   as credits_spent
    from public.credit_ledger where user_id = p.id
) l on true

left join lateral (
  select coalesce(sum(amount_paise), 0) as paid_paise
    from public.payments where user_id = p.id and status = 'captured'
) pay on true

left join lateral (
  select count(*) as feedback_count, round(avg(rating), 2) as avg_rating
    from public.session_feedback where user_id = p.id
) f on true;

revoke all on public.admin_user_overview from public;
revoke all on public.admin_user_overview from anon;
revoke all on public.admin_user_overview from authenticated;
grant select on public.admin_user_overview to service_role;

-- The two counts above are the only per-user scans in the view.
create index if not exists sq_user_mode_idx
  on public.session_questions (user_id, grading_mode) where status = 'graded';
create index if not exists sessions_user_status_idx
  on public.sessions (user_id, status);


-- ----------------------------------------------------------------------------
-- 8. admin_totals
--
-- The strip of numbers across the top of the console. A single row, so the page
-- does not fire six count queries to render six tiles.
--
-- `credits_outstanding` is the one worth watching: it is unspent balance sitting
-- on accounts — a liability, and after a workshop it is mostly granted credits
-- that have not been used yet.
-- ----------------------------------------------------------------------------
drop view if exists public.admin_totals;

create view public.admin_totals
with (security_invoker = on) as
select
  (select count(*) from public.profiles)                                       as users,
  (select count(*) from public.profiles where created_at > now() - interval '7 days')
                                                                               as users_last_7d,
  (select count(*) from public.sessions where status = 'complete')             as interviews_completed,
  (select count(*) from public.session_questions
     where grading_mode = 'coding' and status = 'graded')                      as coding_questions,
  (select count(*) from public.session_questions
     where grading_mode = 'skill' and status = 'graded')                       as skill_questions,
  (select coalesce(sum(credits_balance), 0) from public.profiles)              as credits_outstanding,
  (select coalesce(sum(amount_paise), 0) from public.payments
     where status = 'captured')                                               as revenue_paise,
  (select count(*) from public.session_feedback)                               as feedback_count,
  (select round(avg(rating), 2) from public.session_feedback)                  as avg_rating;

revoke all on public.admin_totals from public;
revoke all on public.admin_totals from anon;
revoke all on public.admin_totals from authenticated;
grant select on public.admin_totals to service_role;


-- ----------------------------------------------------------------------------
-- 9. Make PostgREST notice all of the above.
--
-- Supabase usually reloads its schema cache on DDL by itself, but not always and
-- not instantly. Without this the new tables, views and functions return
-- "relation does not exist" from the API for a few minutes while existing
-- perfectly well in the database, which is a maddening thing to debug.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 10. Make yourself an admin.
--
-- Uncomment, put your own address in, run it. This is the only way in — by
-- design, nothing in the application can write profiles.role.
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- Check it took:
--
--   select email, role from public.profiles where role = 'admin';
-- ----------------------------------------------------------------------------
