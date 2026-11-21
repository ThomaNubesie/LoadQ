-- Who gets the 05:00 / 05:45 raffle TEXT (Thomas, 2026-11-21): drivers active AT
-- UNIVERSAL GROCERY in the last 4 months — loaded there or sat in its line — who are
-- verified, not blocked, and have a phone. While test mode is on, only those on the
-- test list. p_exclude: drivers to skip (the 05:45 reminder skips anyone checked in).
drop function if exists public.loadq_raffle_sms_targets(boolean, uuid[], uuid[]);
create or replace function public.loadq_raffle_sms_targets(p_test boolean, p_allowed uuid[], p_exclude uuid[] default '{}',
                                                           p_zone text default 'ottawa-universal-grocery')
returns table(driver_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select d.id, d.phone
    from public.drivers d
   where d.verified and not d.blocked and coalesce(btrim(d.phone), '') <> ''
     and not (d.id = any(coalesce(p_exclude, '{}')))
     and (not p_test or d.id = any(coalesce(p_allowed, '{}')))
     and (   exists (select 1 from public.loading_history lh where lh.driver_id = d.id and lh.zone_id = p_zone and lh.ended_at > now() - interval '4 months')
          or exists (select 1 from public.queue_entries q   where q.driver_id  = d.id and q.zone_id  = p_zone and q.joined_at  > now() - interval '4 months'));
$$;
revoke execute on function public.loadq_raffle_sms_targets(boolean, uuid[], uuid[], text) from public, anon, authenticated;
