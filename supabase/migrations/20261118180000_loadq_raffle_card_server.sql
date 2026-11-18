-- The code-of-the-day picture is now drawn server-side (edge fn loadq-raffle-card),
-- replacing the weekly MacBook script loadq_raffle_prep.py.
--   * loadq_raffle_round.card_at — set once the picture is uploaded.
--   * cron loadq-raffle-card (every minute) — draws it for any open round of today or
--     later that has a code but no picture yet (i.e. right after the 05:00 round
--     creation), retrying each minute until it succeeds.
--   * cron 46 loadq-raffle-code-mms — attaches the picture only if card_at is set;
--     otherwise sends the text alone instead of a broken image link. Text now gives
--     check-in 05:00-06:01 / draw 06:02-07:00, signed "Concord Express Co Inc."
alter table public.loadq_raffle_round add column if not exists card_at timestamptz;
update public.loadq_raffle_round set card_at = now()   -- pictures already made by the script
 where service_date between date '2026-11-18' and date '2026-11-23' and card_at is null;

select cron.schedule('loadq-raffle-card', '* * * * *', $cron$
  select net.http_post(
    url     := 'https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/loadq-raffle-card',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
               (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')),
    body    := jsonb_build_object('round_id', r.id), timeout_milliseconds := 30000)
  from public.loadq_raffle_round r
  where r.card_at is null and r.code is not null and r.status = 'open'
    and r.service_date >= (now() at time zone 'America/Toronto')::date;
$cron$);
-- cron 46 was edited in place with cron.alter_job (text + card_at guard); see job 46.
