-- Authoritative `zones` table.
-- This is the single source of truth for the queue-close-watchdog Edge
-- Function. Client code in constants/zones.ts is a denormalized cache for
-- UX rendering and offline support — when in doubt the DB row wins.
--
-- Written defensively so it works whether the table already exists with a
-- partial schema or doesn't exist yet.

create table if not exists public.zones (
  id text primary key
);

alter table public.zones add column if not exists name          text;
alter table public.zones add column if not exists region        text;
alter table public.zones add column if not exists latitude      numeric;
alter table public.zones add column if not exists longitude     numeric;
alter table public.zones add column if not exists radius_meters int;
alter table public.zones add column if not exists timezone      text not null default 'America/Toronto';

insert into public.zones (id, name, region, latitude, longitude, radius_meters, timezone) values
  ('ottawa-george',        '140 George Street',           'ottawa',   45.4268, -75.6910, 100, 'America/Toronto'),
  ('gatineau-mcdo',        'McDonald''s Saint-Raymond',   'gatineau', 45.4785, -75.7456,  80, 'America/Toronto'),
  ('montreal-jean-talon',  '5300 Jean-Talon Ouest',       'montreal', 45.5025, -73.6631, 100, 'America/Toronto'),
  ('montreal-berri',       'Berri-UQAM — Sainte-Catherine','montreal',45.5167, -73.5673, 100, 'America/Toronto'),
  ('quebec-shell',         'Shell Laurier',               'quebec',   46.7792, -71.2839,  80, 'America/Toronto'),
  ('quebec-mcdo',          'McDonald''s Laurier',         'quebec',   46.7798, -71.2850,  80, 'America/Toronto'),
  ('laval-desjardins',     'Pavillon Desjardins',         'laval',    45.5724, -73.6920, 100, 'America/Toronto'),
  ('toronto-yorkdale',     'Yorkdale Mall',               'toronto',  43.7255, -79.4502, 150, 'America/Toronto'),
  ('toronto-scarborough',  'Scarborough Town Centre',     'toronto',  43.7757, -79.2576, 150, 'America/Toronto'),
  ('toronto-union',        'Union Station',               'toronto',  43.6452, -79.3806, 120, 'America/Toronto')
on conflict (id) do update set
  name          = excluded.name,
  region        = excluded.region,
  latitude      = excluded.latitude,
  longitude     = excluded.longitude,
  radius_meters = excluded.radius_meters,
  timezone      = excluded.timezone;

alter table public.zones enable row level security;

drop policy if exists "anyone reads zones" on public.zones;
create policy "anyone reads zones"
  on public.zones for select to public using (true);
