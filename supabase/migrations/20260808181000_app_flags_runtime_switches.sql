-- Runtime feature switches, toggleable from the DB with no app rebuild.
-- (Applied to the remote via MCP on 2026-08-08; backfilled here for the repo.)
create table if not exists public.app_flags (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_flags enable row level security;

-- Everyone (incl. anon) may READ flags; nobody but service-role/dashboard may
-- write (no insert/update policy = writes blocked for normal users).
drop policy if exists "flags readable" on public.app_flags;
create policy "flags readable" on public.app_flags for select using (true);

-- Seed the single-session switch in the OFF position.
insert into public.app_flags(key, enabled) values ('single_session_enforce', false)
  on conflict (key) do nothing;

-- Realtime so flipping a flag activates on every running device instantly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_flags'
  ) then
    alter publication supabase_realtime add table public.app_flags;
  end if;
end $$;
