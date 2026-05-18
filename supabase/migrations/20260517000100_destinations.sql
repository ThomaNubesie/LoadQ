-- Admin-managed destination cities. Pricing stays in code (constants/pricing.ts),
-- keyed by these codes; this table only controls which destinations are
-- offered. Admins "remove" a destination by toggling is_active = false.

create table if not exists public.destinations (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true,
  sort_order int not null default 0
);

insert into public.destinations (code, name, sort_order) values
  ('chicoutimi',     'Chicoutimi',     1),
  ('moncton',        'Moncton',        2),
  ('quebec',         'Québec City',    3),
  ('trois-rivieres', 'Trois-Rivières', 4),
  ('montreal',       'Montréal',       5),
  ('sherbrooke',     'Sherbrooke',     6),
  ('ottawa',         'Ottawa',         7),
  ('kingston',       'Kingston',       8),
  ('toronto',        'Toronto',        9)
on conflict (code) do update set
  name       = excluded.name,
  sort_order = excluded.sort_order;

alter table public.destinations enable row level security;

drop policy if exists "anyone reads active destinations" on public.destinations;
create policy "anyone reads active destinations"
  on public.destinations for select to authenticated
  using (is_active = true);

drop policy if exists "admins update destinations" on public.destinations;
create policy "admins update destinations"
  on public.destinations for update to authenticated
  using      (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true))
  with check (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true));

drop policy if exists "admins insert destinations" on public.destinations;
create policy "admins insert destinations"
  on public.destinations for insert to authenticated
  with check (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true));
