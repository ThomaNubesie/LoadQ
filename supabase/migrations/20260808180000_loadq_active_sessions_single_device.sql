-- Single-active-session enforcement (driver AND passenger).
-- One row per user pointing at the most-recently-claimed device session id.
-- (Applied to the remote via MCP on 2026-08-08; backfilled here for the repo.)
create table if not exists public.active_sessions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  platform   text,
  updated_at timestamptz not null default now()
);

alter table public.active_sessions enable row level security;

-- A user may read and manage only their own session row.
drop policy if exists "own session select" on public.active_sessions;
create policy "own session select" on public.active_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "own session insert" on public.active_sessions;
create policy "own session insert" on public.active_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "own session update" on public.active_sessions;
create policy "own session update" on public.active_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime so the previous device is notified the instant it loses the seat.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'active_sessions'
  ) then
    alter publication supabase_realtime add table public.active_sessions;
  end if;
end $$;
