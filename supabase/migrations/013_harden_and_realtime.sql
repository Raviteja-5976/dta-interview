-- ============================================================================
-- 013 · Hardening + realtime + refunds
--
-- Three things the agent pipeline needs that schema.sql does not yet provide.
-- Safe to run against an existing database; every statement is idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Revoke finalize_session from `authenticated`   ** SECURITY **
--
-- finalize_session is `security definer`, so it bypasses RLS, and it performs no
-- ownership check on p_session_id. Granted to `authenticated`, any signed-in
-- user can call it against ANY session id and write arbitrary scores, an
-- arbitrary report, and arbitrary project readiness.
--
-- It is only ever called by the evaluation pipeline, which runs with the service
-- role. db-design.md §5.2 grants it to nobody; the `authenticated` grant was
-- added in schema.sql and should come back out.
-- ----------------------------------------------------------------------------
revoke execute on function public.finalize_session(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  from authenticated;

-- ----------------------------------------------------------------------------
-- 2. Realtime publication
--
-- db-design.md §8: the Processing screen must not poll. The project Overview and
-- the dashboard "Preparing…" chip depend on the same subscription.
--
-- Note the deliberate omission of session_questions — a 15-question grading run
-- would fire 15 client events for no benefit.
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.sessions;
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.projects;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3. refund_credits()
--
-- sitemap-workflow.md §10: a failed evaluation must never silently consume a
-- credit. Same pattern as spend_credits, opposite sign, and written in one
-- transaction so the balance and the ledger can never disagree.
--
-- Service role only: a client-callable refund is a free product.
-- ----------------------------------------------------------------------------
create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount  integer,
  p_session uuid,
  p_reason  text default 'evaluation_failed'
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
  v_already integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Idempotency: a retried evaluation must not refund the same session twice.
  select count(*) into v_already
    from public.credit_ledger
   where session_id = p_session and kind = 'refund';

  if v_already > 0 then
    select credits_balance into v_bal from public.profiles where id = p_user_id;
    return v_bal;
  end if;

  update public.profiles
     set credits_balance = credits_balance + p_amount
   where id = p_user_id
   returning credits_balance into v_bal;

  if v_bal is null then
    raise exception 'user_not_found';
  end if;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
  values (p_user_id, 'refund', p_amount, v_bal, p_session, jsonb_build_object('reason', p_reason));

  return v_bal;
end $$;

revoke all on function public.refund_credits(uuid, integer, uuid, text) from public;
revoke all on function public.refund_credits(uuid, integer, uuid, text) from authenticated;
grant execute on function public.refund_credits(uuid, integer, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. sessions.progress
--
-- db-design.md §8 suggests this for a per-agent progress bar on the Processing
-- screen. Writing stage progress into `error` would be worse than a new column.
-- ----------------------------------------------------------------------------
alter table public.sessions
  add column if not exists progress jsonb not null default '{}'::jsonb;
