-- 07:01 line cards (Thomas, 2026-11-21): after the 07:00 raffle close, every driver who
-- drew gets an MMS of the day's line with their own row highlighted — the card the
-- MacBook sent by hand (loadq_line_card.py / loadq_send_line_mms.py), now server-side
-- in edge fn loadq-line-card. Only lots NOT in test mode. line_cards_at is claimed by
-- the function before sending, so a round is never texted twice.
alter table public.loadq_raffle_round add column if not exists line_cards_at timestamptz;

select cron.schedule('loadq-line-card', '* * * * *', $cron$
  select net.http_post(
    url     := 'https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/loadq-line-card',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
               (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')),
    body    := jsonb_build_object('round_id', r.id), timeout_milliseconds := 120000)
  from public.loadq_raffle_round r
  join public.loadq_raffle_config c on c.zone_id = r.zone_id and c.enabled and not c.test_mode
  where r.service_date = (now() at time zone 'America/Toronto')::date
    and r.status = 'drawn' and r.line_cards_at is null
    and (now() at time zone 'America/Toronto')::time between time '07:01' and time '07:30';
$cron$);

-- Universal Grocery leaves test mode (2026-11-21); the other six lots stay in test mode.
update public.loadq_raffle_config set test_mode = false where zone_id = 'ottawa-universal-grocery';
