-- auth_login_tracking
-- Record every sign-in so we can count a user's logins exactly (the auth audit log
-- is not retained on this project, and auth.users.last_sign_in_at keeps only the
-- latest). A new row in auth.sessions = a successful login (token refresh updates
-- the session rather than inserting, so it does not double-count). Shared project
-- (LoadQ + Kolis); filter by user_id for a given user.
create table if not exists public.auth_login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  ip inet,
  user_agent text
);
create index if not exists auth_login_events_user_idx on public.auth_login_events (user_id, created_at desc);
alter table public.auth_login_events enable row level security;  -- internal only; no policies, so no client can read it

create or replace function public.track_login()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.auth_login_events(user_id, created_at, ip, user_agent)
  values (new.user_id, coalesce(new.created_at, now()), new.ip, new.user_agent);
  return new;
exception when others then
  return new;  -- logging must never block a sign-in
end $$;

drop trigger if exists trg_track_login on auth.sessions;
create trigger trg_track_login after insert on auth.sessions
for each row execute function public.track_login();

-- One-time baseline from currently-active sessions (expired ones are already pruned).
insert into public.auth_login_events(user_id, created_at, ip, user_agent)
select user_id, created_at, ip, user_agent from auth.sessions;
