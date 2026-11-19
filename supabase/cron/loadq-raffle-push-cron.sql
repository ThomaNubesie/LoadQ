-- The two morning raffle nudges. Every minute with a one-minute local guard, so each
-- fires once a day and survives DST (a fixed UTC hour would drift in March).
-- Created INACTIVE on purpose: until a native 1.2.26 build is on drivers' phones there
-- is no raffle screen to open, and a 5am buzz pointing at nothing is worse than silence.
--   enable:  select cron.alter_job(jobid, active := true) from cron.job where jobname like 'loadq-raffle-push%';
-- (cron.job itself is not writable on this project — always go through cron.alter_job.)
select cron.schedule('loadq-raffle-push-open', '* * * * *', $job$
do $$
declare k text;
begin
  if (now() at time zone 'America/Toronto')::time <  time '05:00'
  or (now() at time zone 'America/Toronto')::time >= time '05:01' then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'edge_service_key';
  perform net.http_post(
    url     := 'https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/loadq-raffle-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body    := jsonb_build_object('phase','open'));
end $$;
$job$);

select cron.schedule('loadq-raffle-push-reminder', '* * * * *', $job$
do $$
declare k text;
begin
  if (now() at time zone 'America/Toronto')::time <  time '05:45'
  or (now() at time zone 'America/Toronto')::time >= time '05:46' then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'edge_service_key';
  perform net.http_post(
    url     := 'https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/loadq-raffle-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body    := jsonb_build_object('phase','reminder'));
end $$;
$job$);


select cron.alter_job(jobid, active := false)
  from cron.job where jobname in ('loadq-raffle-push-open','loadq-raffle-push-reminder');
