-- ============================================================================
-- 019 · profiles on the realtime publication
--
-- The credit pill in the app header showed a hardcoded number because no screen
-- but the dashboard and the profile page ever fetched a profile. It now reads
-- `credits_balance` itself and subscribes to its own row — but a balance moves
-- while a page is open (voice time bills per minute as the interview runs, a
-- Stripe purchase lands from a webhook), and a subscription to a table that is
-- not published is a silent no-op, which is exactly the failure mode that
-- produced the stale number in the first place.
--
-- Safe against an existing database; idempotent, like 013.
--
-- RLS still applies to realtime: `profiles_select` (schema.sql §RLS) restricts
-- rows to `auth.uid() = id`, so a client is only ever sent its own balance.
-- ============================================================================

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end $$;
