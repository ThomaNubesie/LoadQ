-- Remote-controlled queue hours (no redeploy/build to change). The watchdog
-- reads load_open_hour + close_hour from here each run.
create table if not exists public.queue_window (
  id int primary key default 1,
  register_open_hour int not null default 0,   -- running list / registration opens
  load_open_hour     int not null default 5,   -- loading clock starts
  close_hour         int not null default 23,  -- window closes
  updated_at timestamptz default now(),
  constraint queue_window_singleton check (id = 1)
);
insert into public.queue_window (id) values (1) on conflict (id) do nothing;
alter table public.queue_window enable row level security;
drop policy if exists queue_window_read on public.queue_window;
create policy queue_window_read on public.queue_window for select using (true);
grant select on public.queue_window to anon, authenticated;
