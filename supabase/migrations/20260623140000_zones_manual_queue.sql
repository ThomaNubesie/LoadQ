-- Manual-queue mode per zone. When true, the queue-close-watchdog treats every
-- driver in the zone as "present" (presentInZone() short-circuits), so the line
-- advances strictly by queue position, ignoring GPS. Used for on-site operator-
-- managed lines (e.g. Universal Grocery) where stale/missing GPS otherwise marks
-- physically-present drivers absent and scrambles the order.
alter table public.zones
  add column if not exists manual_queue boolean not null default false;

update public.zones set manual_queue = true where id = 'ottawa-universal-grocery';
