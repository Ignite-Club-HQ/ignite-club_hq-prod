-- LOCAL SECURITY-TEST PARITY ONLY.
-- Mirrors the target_team_ids validation contract using synthetic local data.
-- This file is applied only by the isolated Docker Supabase baseline.

-- The grouped RSVP UI joins user_roles to profiles. Mirror the current
-- production visibility contract so local RLS exercises the real query rather
-- than suppressing every profile except the caller's own row.
drop policy if exists roles_visible_to_self_or_admin on public.user_roles;
create policy roles_visible_to_shared_club_or_team
on public.user_roles
for select
using (
  user_id = auth.uid()
  or public.is_club_member(auth.uid(), club_id)
  or public.is_team_member(auth.uid(), team_id)
  or public.has_role(auth.uid(), 'app_admin', null, null)
);

create policy profiles_visible_to_shared_club
on public.profiles
for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.user_roles viewer_role
    join public.user_roles target_role
      on target_role.club_id = viewer_role.club_id
     and target_role.club_id is not null
    where viewer_role.user_id = auth.uid()
      and target_role.user_id = profiles.id
  )
);

alter table public.events
  add column if not exists target_team_ids uuid[];

create or replace function public.validate_event_target_team_ids()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  arr_len integer;
  distinct_len integer;
  bad_count integer;
begin
  if new.target_team_ids is null then
    return new;
  end if;

  arr_len := coalesce(array_length(new.target_team_ids, 1), 0);
  if arr_len < 2 then
    raise exception 'target_team_ids must contain at least 2 teams'
      using errcode = 'check_violation';
  end if;

  select count(distinct tid) into distinct_len
  from unnest(new.target_team_ids) as tid;
  if distinct_len <> arr_len then
    raise exception 'target_team_ids must not contain duplicate team ids'
      using errcode = 'check_violation';
  end if;

  if new.team_id is not null then
    raise exception 'target_team_ids can only be set on club-wide events (team_id must be null)'
      using errcode = 'check_violation';
  end if;

  if new.type not in ('game', 'social') then
    raise exception 'target_team_ids is only supported for game or social events'
      using errcode = 'check_violation';
  end if;

  if new.club_id is null then
    raise exception 'target_team_ids requires a club_id'
      using errcode = 'check_violation';
  end if;

  select count(*) into bad_count
  from unnest(new.target_team_ids) as tid
  left join public.teams as team on team.id = tid
  where team.id is null or team.club_id <> new.club_id;

  if bad_count > 0 then
    raise exception 'target_team_ids contains teams that do not belong to the event club'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists events_validate_target_team_ids on public.events;
create trigger events_validate_target_team_ids
before insert or update of target_team_ids, team_id, type, club_id
on public.events
for each row
execute function public.validate_event_target_team_ids();

create or replace function public.can_access_targeted_event(
  _user_id uuid,
  _event_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  event_club uuid;
  event_targets uuid[];
begin
  if _user_id is null or _event_id is null then
    return false;
  end if;

  select club_id, target_team_ids
    into event_club, event_targets
  from public.events
  where id = _event_id;

  if event_club is null then
    return false;
  end if;

  if public.has_role(_user_id, 'app_admin', null, null)
     or public.has_role(_user_id, 'club_admin', event_club, null)
     or public.has_role(_user_id, 'committee_member', event_club, null) then
    return true;
  end if;

  if event_targets is null then
    return public.is_club_member(_user_id, event_club);
  end if;

  if exists (
    select 1
    from unnest(event_targets) as target_id
    where public.is_team_member(_user_id, target_id)
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.child_guardians as guardian
    join public.child_team_assignments as assignment
      on assignment.child_id = guardian.child_id
    where guardian.guardian_id = _user_id
      and assignment.team_id = any(event_targets)
  );
end;
$$;

revoke execute on function public.can_access_targeted_event(uuid, uuid) from public;
revoke execute on function public.can_access_targeted_event(uuid, uuid) from anon;
grant execute on function public.can_access_targeted_event(uuid, uuid) to authenticated;

drop policy if exists events_member_select on public.events;
create policy events_member_select
on public.events
for select
using (
  public.has_role(auth.uid(), 'app_admin', null, null)
  or (
    team_id is null
    and (
      public.has_role(auth.uid(), 'club_admin', club_id, null)
      or public.has_role(auth.uid(), 'committee_member', club_id, null)
    )
  )
  or (
    public.is_club_member(auth.uid(), club_id)
    and (
      target_team_ids is null
      or public.can_access_targeted_event(auth.uid(), id)
    )
  )
);

create or replace function public.event_has_target_team_restriction(_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select event.target_team_ids is not null
      from public.events as event
      where event.id = _event_id
    ),
    false
  );
$$;

revoke execute on function public.event_has_target_team_restriction(uuid) from public;
revoke execute on function public.event_has_target_team_restriction(uuid) from anon;
grant execute on function public.event_has_target_team_restriction(uuid) to authenticated;
grant execute on function public.event_has_target_team_restriction(uuid) to service_role;

create policy rsvps_targeted_access_select
on public.rsvps
as restrictive
for select
using (
  not public.event_has_target_team_restriction(event_id)
  or public.can_access_targeted_event(auth.uid(), event_id)
);

create policy rsvps_targeted_access_insert
on public.rsvps
as restrictive
for insert
with check (
  not public.event_has_target_team_restriction(event_id)
  or public.can_access_targeted_event(auth.uid(), event_id)
);

create policy rsvps_targeted_access_update
on public.rsvps
as restrictive
for update
using (
  not public.event_has_target_team_restriction(event_id)
  or public.can_access_targeted_event(auth.uid(), event_id)
)
with check (
  not public.event_has_target_team_restriction(event_id)
  or public.can_access_targeted_event(auth.uid(), event_id)
);

create policy rsvps_targeted_access_delete
on public.rsvps
as restrictive
for delete
using (
  not public.event_has_target_team_restriction(event_id)
  or public.can_access_targeted_event(auth.uid(), event_id)
);

drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert
on public.events
for insert
with check (
  created_by = auth.uid()
  and (
    public.has_role(auth.uid(), 'club_admin', club_id, null)
    or (
      team_id is not null
      and (
        public.has_role(auth.uid(), 'team_admin', null, team_id)
        or public.has_role(auth.uid(), 'coach', null, team_id)
      )
    )
    or (
      public.has_role(auth.uid(), 'committee_member', club_id, null)
      and team_id is null
      and type in ('game', 'social')
    )
  )
);

drop policy if exists events_admin_update on public.events;
create policy events_admin_update
on public.events
for update
using (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (
    team_id is not null
    and (
      public.has_role(auth.uid(), 'team_admin', null, team_id)
      or public.has_role(auth.uid(), 'coach', null, team_id)
    )
  )
  or (
    public.has_role(auth.uid(), 'committee_member', club_id, null)
    and team_id is null
    and type in ('game', 'social')
  )
)
with check (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (
    team_id is not null
    and (
      public.has_role(auth.uid(), 'team_admin', null, team_id)
      or public.has_role(auth.uid(), 'coach', null, team_id)
    )
  )
  or (
    public.has_role(auth.uid(), 'committee_member', club_id, null)
    and team_id is null
    and type in ('game', 'social')
  )
);

create policy events_admin_delete
on public.events
for delete
using (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (
    team_id is not null
    and (
      public.has_role(auth.uid(), 'team_admin', null, team_id)
      or public.has_role(auth.uid(), 'coach', null, team_id)
    )
  )
  or (
    public.has_role(auth.uid(), 'committee_member', club_id, null)
    and team_id is null
    and type in ('game', 'social')
  )
);
