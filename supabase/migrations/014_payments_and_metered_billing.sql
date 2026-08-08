-- ============================================================================
-- 014 · Razorpay payments + metered session billing
--
-- Run AFTER 013. Every statement is idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payments
--
-- One row per Razorpay order. Exists for three reasons: webhook idempotency
-- (Razorpay retries, and events can arrive out of order), reconciliation
-- against the Razorpay dashboard, and so that a user can see a failed attempt
-- rather than wondering where their money went.
--
-- Amounts are stored in PAISE, matching what Razorpay sends. Converting on read
-- is safer than storing a rounded rupee figure.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.payment_status as enum ('created','authorized','captured','failed','refunded');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,

  provider            text not null default 'razorpay',
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  razorpay_signature  text,

  pack_id             text not null,
  credits             integer not null check (credits > 0),
  amount_paise        integer not null check (amount_paise > 0),
  currency            text not null default 'INR',

  status              public.payment_status not null default 'created',
  -- Set once credits actually land, so the grant can never run twice.
  credited_at         timestamptz,
  failure_reason      text,
  meta                jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_order_idx on public.payments (razorpay_order_id);

alter table public.payments enable row level security;

-- Read-only from the browser. Every write goes through the service role, because
-- a client that could insert a `captured` payment is a free product.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated using (user_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- 2. credit_purchase()
--
-- Grants credits for a captured payment. Idempotent on `credited_at`: Razorpay
-- delivers the checkout callback AND a webhook for the same payment, both call
-- this, and exactly one of them must move the balance.
--
-- The `where credited_at is null` on the UPDATE is the lock. Two concurrent
-- calls race for that row; the loser updates zero rows and returns the existing
-- balance without granting anything.
-- ----------------------------------------------------------------------------
create or replace function public.credit_purchase(
  p_order_id   text,
  p_payment_id text,
  p_signature  text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid;
  v_credits integer;
  v_bal     integer;
  v_claimed boolean := false;
begin
  update public.payments
     set status              = 'captured',
         razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id),
         razorpay_signature  = coalesce(p_signature, razorpay_signature),
         credited_at         = now()
   where razorpay_order_id = p_order_id
     and credited_at is null
   returning user_id, credits into v_user, v_credits;

  if found then
    v_claimed := true;
  end if;

  if not v_claimed then
    -- Already credited, or no such order. Return the current balance so the
    -- caller can respond successfully either way — a duplicate webhook is not
    -- an error.
    select p.credits_balance into v_bal
      from public.profiles p
      join public.payments pay on pay.user_id = p.id
     where pay.razorpay_order_id = p_order_id;
    return v_bal;
  end if;

  update public.profiles
     set credits_balance = credits_balance + v_credits
   where id = v_user
   returning credits_balance into v_bal;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, meta)
  values (
    v_user, 'purchase', v_credits, v_bal,
    jsonb_build_object('provider','razorpay','order_id',p_order_id,'payment_id',p_payment_id)
  );

  return v_bal;
end $$;

revoke all on function public.credit_purchase(text, text, text) from public;
revoke all on function public.credit_purchase(text, text, text) from authenticated;
grant execute on function public.credit_purchase(text, text, text) to service_role;


-- ----------------------------------------------------------------------------
-- 3. settle_session_credits()
--
-- Interviews are metered, so the start-of-session debit is a HOLD for the
-- maximum the session could cost. This returns the unused portion once the real
-- duration is known, and rewrites sessions.credits_charged to what was actually
-- charged — so a later failure refund refunds the settled amount, not the hold.
--
-- Idempotent on the ledger: a settlement row for this session means we are done.
-- ----------------------------------------------------------------------------
create or replace function public.settle_session_credits(
  p_session_id uuid,
  p_final      integer,
  p_meta       jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_held  integer;
  v_back  integer;
  v_bal   integer;
begin
  select user_id, credits_charged into v_user, v_held
    from public.sessions where id = p_session_id;

  if v_user is null then
    raise exception 'session_not_found';
  end if;

  if exists (
    select 1 from public.credit_ledger
     where session_id = p_session_id and meta->>'reason' = 'settlement'
  ) then
    select credits_balance into v_bal from public.profiles where id = v_user;
    return v_bal;
  end if;

  -- Settlement can never charge more than the hold the user agreed to.
  v_back := greatest(0, v_held - greatest(0, p_final));

  update public.sessions
     set credits_charged = least(v_held, greatest(0, p_final))
   where id = p_session_id;

  if v_back = 0 then
    -- Nothing to return, but still record that settlement happened so a retry
    -- cannot re-run it.
    select credits_balance into v_bal from public.profiles where id = v_user;
    insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
    values (v_user, 'refund', 0, v_bal, p_session_id, p_meta || jsonb_build_object('reason','settlement'));
    return v_bal;
  end if;

  update public.profiles
     set credits_balance = credits_balance + v_back
   where id = v_user
   returning credits_balance into v_bal;

  insert into public.credit_ledger (user_id, kind, amount, balance_after, session_id, meta)
  values (
    v_user, 'refund', v_back, v_bal, p_session_id,
    p_meta || jsonb_build_object('reason','settlement','held',v_held,'charged',v_held - v_back)
  );

  return v_bal;
end $$;

revoke all on function public.settle_session_credits(uuid, integer, jsonb) from public;
revoke all on function public.settle_session_credits(uuid, integer, jsonb) from authenticated;
grant execute on function public.settle_session_credits(uuid, integer, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 4. refund_credits() — idempotency narrowed to (session, reason)
--
-- 013 made it idempotent on any refund for the session. That now collides with
-- settlement, which is itself a refund row: a settled session could never
-- receive a failure refund. Scope it to the reason instead.
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
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if exists (
    select 1 from public.credit_ledger
     where session_id = p_session and kind = 'refund' and meta->>'reason' = p_reason
  ) then
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
-- 5. Signup grant
--
-- The old grant was 1 credit. Under metered billing that buys 12 seconds, which
-- is worse than granting nothing. 100 credits is one ~20-minute interview —
-- enough to honour "one free interview, no card".
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits_balance)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    100
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Top up accounts created under the old grant. Only touches users who have
-- never bought anything and are still sitting on a token balance, so it cannot
-- inflate a real one.
do $$
declare
  r record;
  v_bal integer;
begin
  for r in
    select p.id
      from public.profiles p
     where p.credits_balance < 100
       and not exists (
         select 1 from public.credit_ledger l
          where l.user_id = p.id and l.kind in ('purchase','grant')
       )
  loop
    update public.profiles
       set credits_balance = 100
     where id = r.id
     returning credits_balance into v_bal;

    insert into public.credit_ledger (user_id, kind, amount, balance_after, meta)
    values (r.id, 'grant', 100 - 0, v_bal,
            jsonb_build_object('reason','metered_billing_migration'));
  end loop;
end $$;
