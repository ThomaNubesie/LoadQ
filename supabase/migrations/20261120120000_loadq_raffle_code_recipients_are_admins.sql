-- The people who get a lot's code are that lot's raffle admins (Thomas, 2026-11-20).
-- Recipients now carry their driver_id, and adding/removing a recipient adds/removes
-- them from that lot's raffle_admin_ids. The lead admin is never removed this way.
alter table public.loadq_raffle_code_recipients add column if not exists driver_id uuid references public.drivers(id);

update public.loadq_raffle_code_recipients rc
   set driver_id = d.id
  from public.drivers d
 where rc.driver_id is null
   and right(regexp_replace(d.phone, '\D', '', 'g'), 10) = right(regexp_replace(rc.phone, '\D', '', 'g'), 10);

create or replace function public.loadq_raffle_recipient_admin_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.driver_id is null then
      select id into new.driver_id from public.drivers
       where right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(new.phone, '\D', '', 'g'), 10) limit 1;
    end if;
    if new.driver_id is not null then
      update public.loadq_raffle_config
         set raffle_admin_ids = array_append(coalesce(raffle_admin_ids, '{}'), new.driver_id)
       where zone_id = new.zone_id and not (new.driver_id = any(coalesce(raffle_admin_ids, '{}')));
    end if;
    return new;
  else
    update public.loadq_raffle_config
       set raffle_admin_ids = array_remove(raffle_admin_ids, old.driver_id)
     where zone_id = old.zone_id and old.driver_id is not null
       and old.driver_id is distinct from lead_admin_id;
    return old;
  end if;
end $$;

drop trigger if exists loadq_raffle_recipient_admin_sync on public.loadq_raffle_code_recipients;
create trigger loadq_raffle_recipient_admin_sync
  before insert or update or delete on public.loadq_raffle_code_recipients
  for each row execute function public.loadq_raffle_recipient_admin_sync();

-- Current recipients → admins of their lot.
update public.loadq_raffle_config c
   set raffle_admin_ids = (select array_agg(distinct x) from unnest(coalesce(c.raffle_admin_ids, '{}') || array(
         select rc.driver_id from public.loadq_raffle_code_recipients rc
          where rc.zone_id = c.zone_id and rc.driver_id is not null)) x)
 where exists (select 1 from public.loadq_raffle_code_recipients rc where rc.zone_id = c.zone_id);
