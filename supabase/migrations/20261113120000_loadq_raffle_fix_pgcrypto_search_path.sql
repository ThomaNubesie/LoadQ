-- loadq_raffle_fix_pgcrypto_search_path
-- BUG: the Morning Raffle silently disappeared at play time because no round was
-- ever created during the 06:00-07:15 window. loadq_raffle_ensure_round (seed
-- generation) and loadq_raffle_enter (fair raffle_key) call gen_random_bytes() and
-- digest() from pgcrypto, which Supabase installs in the `extensions` schema. Both
-- functions had `set search_path = 'public'` only, so the calls failed at runtime
-- ("function gen_random_bytes(integer) does not exist") and the round insert threw.
-- The cron (loadq-raffle-open) failed every minute of the window; outside the window
-- ensure_round returns early, so the failure was invisible until a real play morning.
-- FIX: add the extensions schema to the search_path so pgcrypto resolves. ALTER only,
-- function bodies unchanged.
alter function public.loadq_raffle_ensure_round(text)
  set search_path = public, extensions;
alter function public.loadq_raffle_enter(text, double precision, double precision, double precision, text, text)
  set search_path = public, extensions;
