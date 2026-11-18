-- LoadQ morning raffle, v2 rules (decided 2026-11-18):
--
--   05:00–06:01  CHECK-IN   Eligible = a driver physically at the lot (geofence) who
--                           taps "I'm at the lot". Location only, no code.
--   06:01        SEAL       The hat holds exactly 1…N, N = drivers checked in. It's
--                           shuffled by the round's seed, committed when the round
--                           opened (verifiable afterwards).
--   06:02        CLEAR      The zone's existing line is cleared — the raffle replaces it.
--   06:02–07:00  DRAW       A checked-in driver enters the code of the day (MMS to the
--                           leads at 06:01) and draws ONE number from the hat; they go
--                           onto the line at that position immediately (live).
--   07:00        CLOSED     Checked-in drivers who didn't draw are excluded (their
--                           number stays empty). Nobody can self-join the zone's line
--                           from the app until 07:00.
--
-- test_mode keeps everything a dry run (nothing touches queue_entries).
-- loadq_raffle_enter keeps its name and signature: in the check-in window it checks
-- in, in the draw window it draws — so older app builds keep working.

-- ── Schema ──────────────────────────────────────────────────────────────────
alter table public.loadq_raffle_config
  add column if not exists checkin_closes_local time not null default '06:01',
  add column if not exists draw_opens_local     time not null default '06:02';

alter table public.loadq_raffle_round
  add column if not exists checkin_closes_at timestamptz,
  add column if not exists draw_opens_at     timestamptz,
  add column if not exists hat_size          int,
  add column if not exists sealed_at         timestamptz,
  add column if not exists line_cleared_at   timestamptz;

alter table public.loadq_raffle_entry add column if not exists drawn_at timestamptz;

-- No two drivers can ever hold the same number in a round.
create unique index if not exists loadq_raffle_entry_round_number_uniq
  on public.loadq_raffle_entry (round_id, assigned_number) where assigned_number is not null;

update public.loadq_raffle_config
   set checkin_opens_local = '05:00', checkin_closes_local = '06:01',
       draw_opens_local = '06:02', draw_at_local = '07:00';

-- Rounds already created ahead of time (by the code-of-the-day staging) get the new times.
update public.loadq_raffle_round r
   set checkin_opens_at  = (r.service_date + c.checkin_opens_local)  at time zone c.timezone,
       checkin_closes_at = (r.service_date + c.checkin_closes_local) at time zone c.timezone,
       draw_opens_at     = (r.service_date + c.draw_opens_local)     at time zone c.timezone,
       draw_at           = (r.service_date + c.draw_at_local)        at time zone c.timezone
  from public.loadq_raffle_config c
 where c.zone_id = r.zone_id and r.status = 'open'
   and r.service_date > (now() at time zone c.timezone)::date;

-- ── Phase of a round right now ──────────────────────────────────────────────
create or replace function public.loadq_raffle_phase(p_round uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when r.id is null                               then 'none'
    when r.status <> 'open'                         then 'closed'
    when now() <  r.checkin_opens_at                then 'before'
    when now() <  coalesce(r.checkin_closes_at, r.draw_at) then 'checkin'
    when now() <  coalesce(r.draw_opens_at, r.draw_at)     then 'sealing'
    when now() <  r.draw_at                         then 'draw'
    else 'closed' end
  from (select 1) one left join public.loadq_raffle_round r on r.id = p_round;
$$;

-- ── Round creation (now opens at 05:00) ─────────────────────────────────────
create or replace function public.loadq_raffle_ensure_round(p_zone text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare c public.loadq_raffle_config; svc date; opens timestamptz; closes timestamptz;
        dopen timestamptz; draws timestamptz; rid uuid; s text; code text;
begin
  select * into c from public.loadq_raffle_config where zone_id = p_zone and enabled;
  if not found then return null; end if;
  svc    := (now() at time zone c.timezone)::date;
  opens  := (svc + c.checkin_opens_local)  at time zone c.timezone;
  closes := (svc + c.checkin_closes_local) at time zone c.timezone;
  dopen  := (svc + c.draw_opens_local)     at time zone c.timezone;
  draws  := (svc + c.draw_at_local)        at time zone c.timezone;
  if now() < opens or now() >= draws then return null; end if;
  select id into rid from public.loadq_raffle_round where zone_id = p_zone and service_date = svc;
  if rid is not null then return rid; end if;
  s    := encode(extensions.gen_random_bytes(32),'hex');
  code := case when c.require_code
               then lpad((floor(random()*power(10, c.code_len)))::bigint::text, c.code_len, '0') end;
  insert into public.loadq_raffle_round(zone_id, service_date, destination_region, status,
        checkin_opens_at, checkin_closes_at, draw_opens_at, draw_at, seed_commit, seed_reveal, code)
  values (p_zone, svc, c.destination_region, 'open', opens, closes, dopen, draws,
          encode(extensions.digest(s,'sha256'),'hex'), s, code)
  on conflict (zone_id, service_date) do nothing
  returning id into rid;
  if rid is null then select id into rid from public.loadq_raffle_round where zone_id = p_zone and service_date = svc; end if;
  return rid;
end $$;

-- ── Seal the hat (06:01) and clear the line (06:02). Idempotent. ───────────
create or replace function public.loadq_raffle_tick(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.loadq_raffle_round; test boolean;
begin
  select * into r from public.loadq_raffle_round where id = p_round for update;
  if not found or r.status <> 'open' then return; end if;
  test := coalesce((select test_mode from public.loadq_raffle_config where zone_id = r.zone_id), true);
  if r.hat_size is null and r.checkin_closes_at is not null and now() >= r.checkin_closes_at then
    update public.loadq_raffle_round
       set hat_size = (select count(*) from public.loadq_raffle_entry where round_id = r.id), sealed_at = now()
     where id = r.id;
  end if;
  if r.line_cleared_at is null and r.draw_opens_at is not null and now() >= r.draw_opens_at then
    if not test then
      delete from public.queue_entries where zone_id = r.zone_id and status <> 'ended';
    end if;
    update public.loadq_raffle_round set line_cleared_at = now() where id = r.id;
  end if;
end $$;

-- ── The hat: 1…hat_size shuffled by the committed seed; next unused value ──
create or replace function public.loadq_raffle_ticket(p_round uuid)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare r public.loadq_raffle_round; pool int; v int; nxt int;
begin
  select * into r from public.loadq_raffle_round where id = p_round;
  if not found then return null; end if;
  pool := coalesce(r.hat_size, 20);
  for v in select i from generate_series(1, pool) i
            order by encode(extensions.digest(r.seed_reveal || ':' || i::text, 'sha256'), 'hex')
  loop
    if not exists (select 1 from public.loadq_raffle_entry e where e.round_id = p_round and e.assigned_number = v) then
      return v;
    end if;
  end loop;
  -- Only reachable on legacy rounds without a sealed hat: carry on past the pool.
  select coalesce(max(assigned_number), pool) + 1 into nxt from public.loadq_raffle_entry where round_id = p_round;
  return nxt;
end $$;

-- ── Check in (05:00–06:01) or draw (06:02–07:00) — same RPC as before ──────
create or replace function public.loadq_raffle_enter(p_zone text, p_lat double precision, p_lng double precision,
                                                     p_accuracy double precision, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); c public.loadq_raffle_config; r public.loadq_raffle_round;
        veh record; dist double precision; k text; rid uuid; new_id uuid; ticket int; phase text;
        mine public.loadq_raffle_entry; admin boolean; svc date; opens timestamptz;
begin
  if uid is null then return jsonb_build_object('error','auth_required'); end if;
  select * into c from public.loadq_raffle_config where zone_id = p_zone and enabled;
  if not found then return jsonb_build_object('error','not_open'); end if;
  admin := public.loadq_raffle_is_admin(p_zone);

  rid := public.loadq_raffle_ensure_round(p_zone);
  if rid is not null then perform public.loadq_raffle_tick(rid); end if;
  phase := public.loadq_raffle_phase(rid);

  -- Outside both windows: admins get a demo (nothing registered); others are told why.
  if phase not in ('checkin','draw') then
    if admin and phase <> 'sealing' then
      return jsonb_build_object('ok',true,'test',true,'registered',false,
        'provisional_position', (1 + floor(random()*9))::int,
        'note','Test tap — not registered (check-in 05:00–06:01, draw 06:02–07:00).');
    end if;
    return jsonb_build_object('error', case phase when 'sealing' then 'draw_not_open'
                                                  when 'closed'  then 'window_closed'
                                                  else 'not_open' end);
  end if;

  select * into r from public.loadq_raffle_round where id = rid for update;   -- serialises everything below
  select * into mine from public.loadq_raffle_entry where round_id = r.id and driver_id = uid;

  -- ── CHECK-IN ──
  if phase = 'checkin' then
    if mine.id is not null then return jsonb_build_object('error','already_checked_in'); end if;
    if not public.loadq_raffle_eligible(uid) then return jsonb_build_object('error','not_eligible'); end if;
    if c.test_mode and not (uid = any(c.allowed_driver_ids)) then return jsonb_build_object('error','not_eligible'); end if;
    select v.id, v.seats into veh from public.vehicles v where v.driver_id = uid and v.is_active order by v.id limit 1;
    if veh.id is null then return jsonb_build_object('error','no_vehicle'); end if;
    if c.require_geofence then
      if p_lat is null or p_lng is null then return jsonb_build_object('error','location_required'); end if;
      if p_accuracy is not null and p_accuracy > c.max_gps_accuracy_m then return jsonb_build_object('error','low_gps_accuracy'); end if;
      dist := public.loadq_haversine_m(p_lat, p_lng, c.geofence_lat, c.geofence_lng);
      if dist > c.geofence_radius_m then return jsonb_build_object('error','not_at_lot','distance_m',round(dist)); end if;
    end if;
    if c.one_checkin_per_device and p_device is not null
       and exists(select 1 from public.loadq_raffle_entry e where e.round_id = r.id and e.device_id = p_device and e.driver_id <> uid) then
      return jsonb_build_object('error','duplicate_device');
    end if;
    k := encode(extensions.digest(r.seed_reveal || uid::text, 'sha256'),'hex');
    insert into public.loadq_raffle_entry(round_id, driver_id, vehicle_id, raffle_key, device_id,
          geo_lat, geo_lng, geo_accuracy_m, geo_ok, code_ok, status)
    values (r.id, uid, veh.id, k, p_device, p_lat, p_lng, p_accuracy, true, false, 'checked_in')
    on conflict (round_id, driver_id) do nothing returning id into new_id;
    if new_id is null then return jsonb_build_object('error','already_checked_in'); end if;
    return jsonb_build_object('ok',true,'registered',true,'checked_in',true,'entry_id',new_id,
      'provisional_position', null,
      'entrant_count',(select count(*) from public.loadq_raffle_entry where round_id = r.id),
      'note','Checked in. The draw opens at '||to_char(r.draw_opens_at at time zone c.timezone,'HH24:MI')||' — come back and draw your number with the code of the day.');
  end if;

  -- ── DRAW ──
  if mine.id is null then return jsonb_build_object('error','not_checked_in'); end if;
  if mine.assigned_number is not null then return jsonb_build_object('error','already_raffled','assigned_number',mine.assigned_number); end if;
  if c.require_code and not (p_code is not null and btrim(p_code) = r.code) then return jsonb_build_object('error','bad_code'); end if;

  ticket := public.loadq_raffle_ticket(r.id);
  update public.loadq_raffle_entry
     set assigned_number = ticket, drawn_at = now(), code_ok = true, status = 'drawn'
   where id = mine.id;

  -- Live: straight onto the line at that number (real mode only).
  if not c.test_mode then
    perform set_config('loadq.raffle_insert', '1', true);
    delete from public.queue_entries where driver_id = uid and status <> 'ended';
    insert into public.queue_entries(zone_id, driver_id, vehicle_id, position, status,
          destination_region, seats_boarded, seats_locked, seat_states, joined_at)
    values (r.zone_id, uid, mine.vehicle_id, ticket, 'waiting', r.destination_region, 0, 0, '[]'::jsonb, now());
    -- No loading during the draw: everyone waits; finalize at 07:00 starts the lowest number.
  end if;

  return jsonb_build_object('ok',true,'registered',true,'entry_id',mine.id,
    'provisional_position',ticket, 'assigned_number',ticket,'final',true,
    'entrant_count',(select count(*) from public.loadq_raffle_entry where round_id = r.id and assigned_number is not null),
    'note','Your number is '||ticket||' — you are #'||ticket||' on the line.');
end $$;

-- ── Close at 07:00: no auto-draw; the undrawn are excluded ─────────────────
create or replace function public.loadq_raffle_finalize(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.loadq_raffle_round; test boolean; n int; e record;
begin
  select * into r from public.loadq_raffle_round where id = p_round for update;
  if not found then return jsonb_build_object('error','no_round'); end if;
  if r.status = 'drawn' then return jsonb_build_object('ok',true,'already',true); end if;
  test := coalesce((select test_mode from public.loadq_raffle_config where zone_id = r.zone_id), true);
  perform public.loadq_raffle_tick(r.id);   -- in case the window passed with no tick

  update public.loadq_raffle_entry set status = 'excluded'
   where round_id = r.id and assigned_number is null;

  -- Safety net: every drawn driver is on the line at their number (real mode).
  if not test then
    perform set_config('loadq.raffle_insert', '1', true);
    for e in select * from public.loadq_raffle_entry where round_id = r.id and assigned_number is not null loop
      if not exists (select 1 from public.queue_entries q where q.driver_id = e.driver_id and q.status <> 'ended') then
        insert into public.queue_entries(zone_id, driver_id, vehicle_id, position, status,
              destination_region, seats_boarded, seats_locked, seat_states, joined_at)
        values (r.zone_id, e.driver_id, e.vehicle_id, e.assigned_number, 'waiting', r.destination_region, 0, 0, '[]'::jsonb, now())
        on conflict do nothing;
      end if;
    end loop;
    perform public.loadq_sync_loader(r.zone_id, r.destination_region);
  end if;

  select count(*) into n from public.loadq_raffle_entry where round_id = r.id and assigned_number is not null;
  update public.loadq_raffle_round set status = 'drawn', drawn_at = now(), entrant_count = n where id = r.id;
  return jsonb_build_object('ok',true,'entrants',n,'dry_run',test);
end $$;

-- ── Status for the app (adds phase; my_number only once drawn) ─────────────
create or replace function public.loadq_raffle_status(p_zone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.loadq_raffle_config; rid uuid; r public.loadq_raffle_round;
        mine public.loadq_raffle_entry; elig boolean; admin boolean; phase text;
begin
  if uid is null then return jsonb_build_object('error','auth_required'); end if;
  select * into c from public.loadq_raffle_config where zone_id = p_zone;
  rid := public.loadq_raffle_ensure_round(p_zone);
  if rid is null then
    select id into rid from public.loadq_raffle_round
     where zone_id = p_zone and service_date = (now() at time zone coalesce(c.timezone,'America/Toronto'))::date;
  end if;
  if rid is not null then perform public.loadq_raffle_tick(rid); select * into r from public.loadq_raffle_round where id = rid; end if;
  phase := public.loadq_raffle_phase(rid);
  elig  := public.loadq_raffle_eligible(uid) and (coalesce(c.test_mode,false) = false or uid = any(c.allowed_driver_ids));
  admin := public.loadq_raffle_is_admin(p_zone);
  if rid is not null then select * into mine from public.loadq_raffle_entry where round_id = rid and driver_id = uid; end if;
  return jsonb_build_object(
    'zone', p_zone, 'round_id', r.id, 'status', coalesce(r.status,'none'), 'phase', phase,
    'test_mode', coalesce(c.test_mode,false), 'is_admin', coalesce(admin,false),
    'window_open', phase in ('checkin','draw'),
    'checkin_opens_at', r.checkin_opens_at, 'checkin_closes_at', r.checkin_closes_at,
    'draw_opens_at', r.draw_opens_at, 'draw_at', r.draw_at,
    'seed_commit', r.seed_commit, 'hat_size', r.hat_size,
    'entrant_count', coalesce((select count(*) from public.loadq_raffle_entry where round_id = r.id),0),
    'drawn_count',   coalesce((select count(*) from public.loadq_raffle_entry where round_id = r.id and assigned_number is not null),0),
    'eligible', coalesce(elig,false),
    'checked_in', mine.id is not null,
    'already_raffled', mine.assigned_number is not null,
    'excluded', coalesce(mine.status = 'excluded', false),
    'my_number', mine.assigned_number,
    'can_raffle', coalesce(
        (phase = 'checkin' and elig and mine.id is null)
     or (phase = 'draw' and mine.id is not null and mine.assigned_number is null)
     or (admin and phase not in ('checkin','draw','sealing')), false)
  );
end $$;

-- ── Live board: only drivers who have drawn, at their real number ──────────
create or replace function public.loadq_raffle_result(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.loadq_raffle_round;
begin
  select * into r from public.loadq_raffle_round where id = p_round;
  if not found then return jsonb_build_object('error','no_round'); end if;
  return jsonb_build_object(
    'round_id', r.id, 'status', r.status, 'drawn_at', r.drawn_at, 'final', r.status = 'drawn',
    'hat_size', r.hat_size, 'seed_commit', r.seed_commit,
    'seed_reveal', case when r.status = 'drawn' then r.seed_reveal end,
    'order', (select coalesce(jsonb_agg(row_to_json(x) order by x.pos), '[]'::jsonb) from (
        select e.assigned_number as pos, e.driver_id, split_part(coalesce(d.full_name,''),' ',1) as name, v.seats
          from public.loadq_raffle_entry e
          join public.drivers d on d.id = e.driver_id
          join public.vehicles v on v.id = e.vehicle_id
         where e.round_id = r.id and e.assigned_number is not null) x));
end $$;

-- ── Admin monitor: checked-in list with drawn numbers ──────────────────────
create or replace function public.loadq_raffle_monitor(p_zone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.loadq_raffle_is_admin(p_zone) then return jsonb_build_object('error','forbidden'); end if;
  select id into rid from public.loadq_raffle_round where zone_id = p_zone
     and service_date = (now() at time zone 'America/Toronto')::date;
  if rid is null then return jsonb_build_object('error','no_round'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('driver_id', e.driver_id, 'checked_in_at', e.checked_in_at,
            'provisional', e.assigned_number, 'number', e.assigned_number, 'status', e.status,
            'geo_ok', e.geo_ok, 'code_ok', e.code_ok) order by e.checked_in_at), '[]'::jsonb)
          from public.loadq_raffle_entry e where e.round_id = rid);
end $$;

-- ── Nobody self-joins the raffle zone's line from the app until 07:00 ───────
-- Only direct app inserts (role 'authenticated') are blocked; admin tools and the
-- raffle itself run as SECURITY DEFINER and are unaffected. Real mode only.
create or replace function public.loadq_raffle_block_selfjoin()
returns trigger language plpgsql set search_path = public as $$
declare c public.loadq_raffle_config; svc date;
begin
  if current_user <> 'authenticated' then return new; end if;
  select * into c from public.loadq_raffle_config where zone_id = new.zone_id and enabled and not test_mode;
  if not found then return new; end if;
  svc := (now() at time zone c.timezone)::date;
  if now() >= (svc + c.checkin_opens_local) at time zone c.timezone
     and now() < (svc + c.draw_at_local) at time zone c.timezone then
    raise exception 'raffle_in_progress: the line opens at %', to_char(c.draw_at_local, 'HH24:MI')
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists loadq_raffle_block_selfjoin on public.queue_entries;
create trigger loadq_raffle_block_selfjoin before insert on public.queue_entries
  for each row execute function public.loadq_raffle_block_selfjoin();

-- Minute job: create the round at 05:00, seal at 06:01, clear at 06:02.
do $$ begin
  perform cron.unschedule('loadq-raffle-open') where exists (select 1 from cron.job where jobname = 'loadq-raffle-open');
end $$;
select cron.schedule('loadq-raffle-open', '* * * * *', $cron$
  select public.loadq_raffle_tick(public.loadq_raffle_ensure_round(zone_id))
    from public.loadq_raffle_config where enabled;
$cron$);
