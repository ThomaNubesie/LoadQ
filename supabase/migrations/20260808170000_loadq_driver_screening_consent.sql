-- A5: auditable driver consent for licence/registration/record verification.
-- Legal prerequisite for the MTO ARP + Certn/Sterling checks. One row per consent
-- event (append-only trail); latest non-revoked row is the active consent.
create table if not exists public.loadq_driver_consents (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  version       text not null,
  scopes        text[] not null default '{}',
  consented_at  timestamptz not null default now(),
  user_agent    text,
  revoked_at    timestamptz
);
create index if not exists loadq_driver_consents_driver_idx
  on public.loadq_driver_consents(driver_id, consented_at desc);

alter table public.loadq_driver_consents enable row level security;

drop policy if exists loadq_consent_sel_own on public.loadq_driver_consents;
create policy loadq_consent_sel_own on public.loadq_driver_consents
  for select using (driver_id = auth.uid() or public.loadq_is_admin());

drop policy if exists loadq_consent_ins_own on public.loadq_driver_consents;
create policy loadq_consent_ins_own on public.loadq_driver_consents
  for insert with check (driver_id = auth.uid());

-- Record a consent event for the signed-in driver.
create or replace function public.loadq_record_screening_consent(
  p_version text, p_scopes text[], p_user_agent text default null)
returns public.loadq_driver_consents
language plpgsql security definer set search_path = public as $$
declare v_row public.loadq_driver_consents;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.loadq_driver_consents(driver_id, version, scopes, user_agent)
  values (auth.uid(), coalesce(p_version, 'v1'), coalesce(p_scopes, '{}'::text[]), p_user_agent)
  returning * into v_row;
  return v_row;
end $$;

-- Latest active consent for the signed-in driver (null if none / revoked).
create or replace function public.loadq_screening_consent_status()
returns table(version text, scopes text[], consented_at timestamptz)
language sql security definer set search_path = public as $$
  select version, scopes, consented_at
  from public.loadq_driver_consents
  where driver_id = auth.uid() and revoked_at is null
  order by consented_at desc limit 1;
$$;

grant execute on function public.loadq_record_screening_consent(text, text[], text) to authenticated;
grant execute on function public.loadq_screening_consent_status() to authenticated;
