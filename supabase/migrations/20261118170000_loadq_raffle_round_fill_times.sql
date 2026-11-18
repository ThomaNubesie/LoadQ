-- Any round inserted without the two-step times (e.g. by the MacBook prep script
-- loadq_raffle_prep.py, which stamps only checkin_opens_at + draw_at) gets
-- checkin_closes_at / draw_opens_at filled from loadq_raffle_config. Without
-- them the phase logic would run check-in until draw_at, never seal the hat and
-- never open the draw.
create or replace function public.loadq_raffle_round_fill_times()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.loadq_raffle_config;
begin
  if new.checkin_closes_at is not null and new.draw_opens_at is not null then return new; end if;
  select * into c from public.loadq_raffle_config where zone_id = new.zone_id;
  if not found then return new; end if;
  new.checkin_closes_at := coalesce(new.checkin_closes_at, (new.service_date + c.checkin_closes_local) at time zone c.timezone);
  new.draw_opens_at     := coalesce(new.draw_opens_at,     (new.service_date + c.draw_opens_local)     at time zone c.timezone);
  return new;
end $$;

drop trigger if exists loadq_raffle_round_fill_times on public.loadq_raffle_round;
create trigger loadq_raffle_round_fill_times before insert on public.loadq_raffle_round
  for each row execute function public.loadq_raffle_round_fill_times();
