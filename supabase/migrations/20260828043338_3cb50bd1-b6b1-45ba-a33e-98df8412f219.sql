create or replace function public.child_is_in_event_audience(_event_id uuid, _child_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.mini_league_id is not null then true
    when e.team_id is not null then exists (
      select 1 from public.child_team_assignments cta
      where cta.child_id = _child_id and cta.team_id = e.team_id)
    when coalesce(array_length(e.target_team_ids, 1), 0) > 0 then exists (
      select 1 from public.child_team_assignments cta
      where cta.child_id = _child_id and cta.team_id = any(e.target_team_ids))
    else true
  end
  from public.events e
  where e.id = _event_id
$$;

grant execute on function public.child_is_in_event_audience(uuid, uuid) to authenticated, service_role;

create or replace function public.enforce_child_event_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  if new.child_id is null then
    return new;
  end if;

  -- Admin overrides (app admins, and club admins of the event's club) stay open.
  if public.has_role(auth.uid(), 'app_admin') then
    return new;
  end if;

  select e.club_id into v_club_id from public.events e where e.id = new.event_id;

  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('club_admin', 'app_admin')
      and (ur.club_id = v_club_id or ur.club_id is null)
  ) then
    return new;
  end if;

  if not public.child_is_in_event_audience(new.event_id, new.child_id) then
    raise exception 'This child is not in this event''s audience'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_child_event_audience_trg on public.rsvps;
create trigger enforce_child_event_audience_trg
before insert or update of child_id, event_id on public.rsvps
for each row execute function public.enforce_child_event_audience();