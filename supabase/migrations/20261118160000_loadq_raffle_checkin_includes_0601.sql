-- Check-in includes the whole 06:01 minute: it closes at 06:02:00. The hat seals
-- and the draw opens at that same moment (loadq_raffle_tick seals first, then
-- clears the line, in one pass; the draw RPC ticks before drawing).
--   05:00:00–06:01:59  CHECK-IN
--   06:02:00           SEAL (1…N) + CLEAR LINE + DRAW OPENS
--   06:02–07:00        DRAW
update public.loadq_raffle_config
   set checkin_closes_local = '06:02', draw_opens_local = '06:02';

alter table public.loadq_raffle_config
  alter column checkin_closes_local set default '06:02';

-- Rounds already created ahead (prep script) move to the new close.
update public.loadq_raffle_round r
   set checkin_closes_at = (r.service_date + c.checkin_closes_local) at time zone c.timezone,
       draw_opens_at     = (r.service_date + c.draw_opens_local)     at time zone c.timezone
  from public.loadq_raffle_config c
 where c.zone_id = r.zone_id and r.status = 'open' and r.hat_size is null
   and r.service_date >= (now() at time zone c.timezone)::date;
