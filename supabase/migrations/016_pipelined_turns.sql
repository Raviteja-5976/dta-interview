-- 016 · Pipelined turns
--
-- The live loop no longer decides the next question inside the turn that asks
-- it. The turn takes the rule layer's top-ranked question (pure code, ~1ms) and
-- plays its prepared audio, while a SEPARATE request reads the answer properly
-- and, if the answer is worth digging into, writes a follow-up here for the turn
-- after next to pick up.
--
-- ── Why its own column and not a key inside live_state ───────────────────────
-- Because two requests are now in flight against the same session at the same
-- time. /turn writes the whole of live_state; /reflect writes only this. Putting
-- the follow-up inside live_state would mean both doing read-modify-write on one
-- JSONB value, and whichever landed second would silently discard the other's
-- work — losing either the follow-up or, far worse, the turn's evidence state.
--
-- Separate columns cannot clobber each other, which makes the concurrency
-- correct by construction rather than by timing.

alter table public.sessions
  add column if not exists pending_followup jsonb;

comment on column public.sessions.pending_followup is
  'A dig-deeper question produced by /reflect from an earlier answer, waiting to be asked. Cleared by the turn that asks it. Null most of the time.';
