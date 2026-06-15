-- LoadQ watchdog changes (2026-06-15):
--   1. Two drivers can never occupy the same queue position on a route.
--   2. New loading-window policy: the FIRST driver of the day in a zone gets 4h
--      ONLY if they start loading in the 04:00–05:59 local window; everyone
--      else gets 2h.
--
-- Apply each statement below one at a time in the Supabase SQL editor.

-- ── 1. Unique position per (zone, destination) ─────────────────────────────
-- The app computes `position = max(position)+1` client-side, which can race when
-- two drivers join the same route at the same instant. This functional unique
-- index makes a duplicate physically impossible (the loser's insert fails with
-- 23505, and the client then retries with a recomputed position). COALESCE maps
-- a NULL destination_region to '' so those rows are deduped too.
--
-- If this errors with "could not create unique index ... duplicate key", run the
-- duplicate-finder below first and fix the offending rows, then re-run this.
create unique index if not exists queue_entries_zone_dest_position_uniq
  on public.queue_entries (zone_id, coalesce(destination_region, ''), position);

-- Duplicate-finder (read-only — run this ONLY if the index creation above
-- failed). Any rows it returns share a slot and must be re-numbered/removed
-- before the unique index can be created:
--   select zone_id, destination_region, position, count(*)
--     from public.queue_entries
--    group by zone_id, destination_region, position
--   having count(*) > 1;

-- ── 2. Loading-window length: first-of-day-in-4-to-6am gets 4h, else 2h ─────
create or replace function public.loadq_load_minutes(p_zone text)
returns integer
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  tz        text;
  day_start timestamptz;
  cnt       integer;
  hr        integer;
begin
  select timezone into tz from public.zones where id = p_zone;
  tz := coalesce(tz, 'America/Toronto');
  day_start := date_trunc('day', now() at time zone tz) at time zone tz;

  -- Loaders so far today in this zone: completed sessions in history PLUS
  -- anyone currently loading. cnt = 0 means nobody has loaded yet today.
  select count(*) into cnt from public.loading_history
   where zone_id = p_zone and load_start_at >= day_start;
  cnt := cnt + (select count(*) from public.queue_entries
                where zone_id = p_zone and status = 'loading');

  -- Current local hour in the zone (0–23).
  hr := extract(hour from (now() at time zone tz))::int;

  -- The first driver of the day gets 4h, but only if they start in the
  -- 04:00–05:59 window. Everyone else (including a first loader who shows up
  -- at 06:00 or later) gets 2h.
  return case when cnt = 0 and hr >= 4 and hr < 6 then 240 else 120 end;
end; $$;

grant execute on function public.loadq_load_minutes(text) to authenticated, anon, service_role;
