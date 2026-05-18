-- Admin-managed zones: address + soft-delete column, admin flag on drivers,
-- RLS so only admins can write zones (anyone can read active ones).

alter table public.zones
  add column if not exists address   text,
  add column if not exists is_active boolean not null default true;

-- Backfill address from constants/zones.ts seed values (idempotent).
update public.zones set address = '140 George St, Ottawa, ON'              where id = 'ottawa-george'        and address is null;
update public.zones set address = 'Boul. Saint-Raymond, Gatineau, QC'      where id = 'gatineau-mcdo'        and address is null;
update public.zones set address = '5300 Rue Jean-Talon O, Montréal, QC'    where id = 'montreal-jean-talon'  and address is null;
update public.zones set address = 'Rue Sainte-Catherine E, Montréal, QC'   where id = 'montreal-berri'       and address is null;
update public.zones set address = 'Boul. Laurier, Québec, QC'              where id = 'quebec-shell'         and address is null;
update public.zones set address = 'Boul. Laurier, Québec, QC'              where id = 'quebec-mcdo'          and address is null;
update public.zones set address = 'Laval, QC'                              where id = 'laval-desjardins'     and address is null;
update public.zones set address = '3401 Dufferin St, Toronto, ON'          where id = 'toronto-yorkdale'     and address is null;
update public.zones set address = '300 Borough Dr, Scarborough, ON'        where id = 'toronto-scarborough'  and address is null;
update public.zones set address = '65 Front St W, Toronto, ON'             where id = 'toronto-union'        and address is null;

-- Admin flag on driver profile
alter table public.drivers
  add column if not exists is_admin boolean not null default false;

-- RLS: read active zones, admin writes
alter table public.zones enable row level security;

drop policy if exists "anyone reads zones"        on public.zones;
drop policy if exists "anyone reads active zones" on public.zones;
create policy "anyone reads active zones"
  on public.zones for select to public
  using (is_active = true);

drop policy if exists "admins insert zones" on public.zones;
create policy "admins insert zones"
  on public.zones for insert to authenticated
  with check (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true));

drop policy if exists "admins update zones" on public.zones;
create policy "admins update zones"
  on public.zones for update to authenticated
  using      (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true))
  with check (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true));

-- We deliberately do not allow DELETE; admins toggle is_active=false instead,
-- so historical queue_entries.zone_id references remain valid.
