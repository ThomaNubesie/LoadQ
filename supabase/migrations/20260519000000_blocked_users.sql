-- Add a `blocked` flag to drivers and passengers, plus an admin-only RPC to
-- toggle it. App-level gates (services/queue.ts, services/claims.ts) refuse
-- queue join / seat claim from blocked users with a translated error.

alter table public.drivers
  add column if not exists blocked boolean not null default false;

alter table public.passengers
  add column if not exists blocked boolean not null default false;

create or replace function public.set_user_blocked(
  p_id    uuid,
  p_table text,
  p_val   boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drivers d
    where d.id = auth.uid() and d.is_admin = true
  ) then
    raise exception 'not authorized: admin only';
  end if;

  if p_table = 'drivers' then
    update public.drivers set blocked = p_val where id = p_id;
  elsif p_table = 'passengers' then
    update public.passengers set blocked = p_val where id = p_id;
  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$$;

grant execute on function public.set_user_blocked(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
