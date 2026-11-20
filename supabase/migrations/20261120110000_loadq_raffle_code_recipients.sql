-- The 06:01 code-of-the-day text, per lot. Recipients live in a list instead of being
-- hard-coded in cron 46, so they can be swapped without touching the job:
--   insert into loadq_raffle_code_recipients(zone_id, name, phone) values ('<zone>', 'Name', '6135551234');
--   delete from loadq_raffle_code_recipients where zone_id = '<zone>' and phone = '6135551234';
-- Each lot's text carries that lot's own code and picture.
create table if not exists public.loadq_raffle_code_recipients (
  zone_id    text not null references public.loadq_raffle_config(zone_id) on delete cascade,
  name       text not null,
  phone      text not null,
  created_at timestamptz not null default now(),
  primary key (zone_id, phone)
);
alter table public.loadq_raffle_code_recipients enable row level security;   -- no policies: server only

-- Recipients (names + phone numbers) were inserted directly in the database on
-- 2026-11-20 and are deliberately NOT kept in the repo. List them with:
--   select zone_id, name from loadq_raffle_code_recipients order by 1, 2;

-- Cron 46: every lot with a round today and at least one recipient.
select cron.alter_job((select jobid from cron.job where jobname = 'loadq-raffle-code-mms'), command := $cmd$
do $$
declare
  r record; k text; media text; msg text;
  tz  constant text := 'America/Toronto';
  ref constant text := 'kzjptcpjpwlxfofzhyku';
begin
  if (now() at time zone tz)::time <  time '06:01'
  or (now() at time zone tz)::time >= time '06:02' then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'edge_service_key';

  for r in
    select rd.id, rd.code, rd.card_at, rc.phone
      from public.loadq_raffle_round rd
      join public.loadq_raffle_config c on c.zone_id = rd.zone_id and c.enabled
      join public.loadq_raffle_code_recipients rc on rc.zone_id = rd.zone_id
     where rd.service_date = (now() at time zone tz)::date and rd.code is not null
  loop
    media := 'https://'||ref||'.supabase.co/storage/v1/object/public/marketing/loadq/raffle-'||r.id||'.png';
    msg   := 'LoadQ - Tirage du matin. Code du jour : '||r.code||
             '. Inscription au stationnement 05:00-06:01, tirage avec le code 06:02-07:00.'||
             ' / Morning raffle. Code of the day: '||r.code||
             '. Check in at the lot 05:00-06:01, draw with the code 06:02-07:00. - Concord Express Co Inc.';
    perform net.http_post(
      url     := 'https://'||ref||'.supabase.co/functions/v1/loadq-send-sms',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
      body    := case when r.card_at is not null
                      then jsonb_build_object('to', r.phone, 'body', msg, 'media_url', media)
                      else jsonb_build_object('to', r.phone, 'body', msg) end);
  end loop;
end $$;
$cmd$);
