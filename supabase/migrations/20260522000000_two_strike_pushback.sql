-- P85: Two-strike pushback rule. Each time a driver's 2-hour loading clock
-- expires without departing, they're moved to the back of the queue AND we
-- bump their pushback_count. If the next loading session also times out
-- (count would reach 2), they're removed from the queue entirely. The count
-- resets to 0 when they leave the queue voluntarily or rejoin.

alter table public.queue_entries
  add column if not exists pushback_count int not null default 0;

notify pgrst, 'reload schema';
