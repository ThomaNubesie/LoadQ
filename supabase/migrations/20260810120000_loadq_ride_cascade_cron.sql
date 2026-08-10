-- A7 cascade tick: every minute, expire stale ride offers and re-dispatch
-- on-demand requests that still need a driver (via the loadq-ride-cascade edge
-- fn → loadq-ride-dispatch). Applied to the remote on 2026-08-10; backfilled here.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'loadq-ride-cascade') then
    perform cron.unschedule('loadq-ride-cascade');
  end if;
end $$;
select cron.schedule('loadq-ride-cascade', '* * * * *', $job$
  select net.http_post(
    url := 'https://kzjptcpjpwlxfofzhyku.functions.supabase.co/loadq-ride-cascade',
    headers := '{"Content-Type":"application/json","x-kolis-secret":"kolis_notify_9f3a2c7b1e6d4084"}'::jsonb,
    body := '{}'::jsonb
  );
$job$);
