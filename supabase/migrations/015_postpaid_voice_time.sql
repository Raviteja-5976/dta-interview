-- ============================================================================
-- 015 · Post-paid voice time
--
-- Run AFTER 014. Every statement is idempotent.
--
-- Voice is no longer held upfront. Modules are still charged before the
-- interview starts (they are generated during preparation, so the spend is
-- already incurred), but conversation time is billed afterwards from the actual
-- elapsed duration.
--
-- 014's settle_session_credits refunded the unused part of a hold. With nothing
-- held there is nothing to refund, so it is superseded by charge_interview_time.
-- It stays in place for any session that started under the old model.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- charge_interview_time()n
--
-- Debits voice time at the end of a session.
--
-- The awkward part of post-paid billing is that `profiles.credits_balance` has a
-- `>= 0` CHECK. A plain debit could violate it and throw, which would lose the
-- charge entirely. The app prevents this by capping every interview at what the
-- balance affords (see planSession), but "should never happen" is not a billing
-- strategy: this debits at most the available balance, records any shortfall in
-- the ledger, and always succeeds.
--
-- Idempotent on the ledger — a retried settlement charges once.
-- ----------------------------------------------------------------------------
create or replace function public.charge_interview_time(
  p_session_id uuid,
  p_minutes    integer,
  p_meta       jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid;
  v_owed      integer;
  v_balance   integer;
  v_charged   integer;
  v_shortfall integer;
begin
  select user_id into v_user from public.sessions where id = p_session_id;
  if v_user is null then
    raise exception 'session_not_found';
  end if;

  if exists (
    select 1 from public.credit_ledger
     where session_id = p_session_id and meta->>'reason' = 'voice_time'
  ) then
    select credits_balance into v_balance from public.profiles where id = v_user;
    return v_balance;
  end if;

  v_owed := greatest(0, coalesce(p_minutes, 0)) * 5;

  if v_owed = 0 then
    select credits_balance into v_balance from public.profiles where id = v_user;
    return v_balance;
  end if;

  -- Lock the row and take what is actually there.
  select credits_balance into v_balance
    from public.profiles where id = v_user for update;

  v_charged   := least(v_owed, v_balance);
  v_shortfall := v_owed - v_charged;

  update public.profiles
     set credits_balance = credits_balance - v_charged
   where id = v_user
   returning credits_balance into v_balance;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
  values (
    v_user, 'spend', -v_charged, v_balance, p_session_id,
    p_meta || jsonb_build_object(
      'reason', 'voice_time',
      'minutes', p_minutes,
      'owed', v_owed,
      -- Non-zero means an interview outran the ceiling that was supposed to stop
      -- it. Worth alerting on: it is a bug in the cap, not in the billing.
      'shortfall', v_shortfall
    )
  );

  update public.sessions
     set credits_charged = credits_charged + v_charged
   where id = p_session_id;

  return v_balance;
end $$;

revoke all on function public.charge_interview_time(uuid, integer, jsonb) from public;
revoke all on function public.charge_interview_time(uuid, integer, jsonb) from authenticated;
grant execute on function public.charge_interview_time(uuid, integer, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- Reconciliation view.
--
-- Post-paid billing has one failure mode worth watching: a session that ended
-- but never got charged, because the settlement call failed after the interview
-- was already over. Those are lost revenue and invisible without a query.
-- ----------------------------------------------------------------------------
create or replace view public.unbilled_sessions as
  select s.id            as session_id,
         s.user_id,
         s.project_id,
         s.duration_sec,
         s.ended_at,
         s.credits_charged
    from public.sessions s
   where s.ended_at is not null
     and s.duration_sec > 0
     and not exists (
       select 1 from public.credit_ledger l
        where l.session_id = s.id and l.meta->>'reason' = 'voice_time'
     );

revoke all on public.unbilled_sessions from public;
revoke all on public.unbilled_sessions from authenticated;
grant select on public.unbilled_sessions to service_role;
