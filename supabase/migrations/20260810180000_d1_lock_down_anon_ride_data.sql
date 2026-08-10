-- D1: stop the public anon key from reading live ride data (driver positions,
-- vehicles, zones). Authenticated app reads keep working; passenger board reads
-- go through SECURITY DEFINER RPCs. Applied to remote via MCP 2026-08-10.
drop policy if exists "Anyone sees queue in zone" on public.queue_entries;

drop policy if exists "Anyone sees active zones" on public.zones;
drop policy if exists "anyone reads active zones" on public.zones;
drop policy if exists "zones_select_auth" on public.zones;
create policy "zones_select_auth" on public.zones for select to authenticated using (true);

revoke all privileges on public.queue_entries from anon;
revoke all privileges on public.zones from anon;
