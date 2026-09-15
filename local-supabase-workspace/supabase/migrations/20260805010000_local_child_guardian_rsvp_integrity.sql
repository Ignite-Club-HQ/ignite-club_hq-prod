-- LOCAL TEST PARITY ONLY. Never deploy this migration.
-- Mirrors the production canonical-child boundary and guardian RSVP shape
-- using only tables present in the isolated synthetic baseline.

create or replace function public.prevent_duplicate_child_for_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is null or btrim(new.name) = '' or new.parent_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.children c
    where c.id <> new.id
      and lower(btrim(c.name)) = lower(btrim(new.name))
      and (
        c.parent_id = new.parent_id
        or exists (
          select 1 from public.child_guardians guardian
          where guardian.child_id = c.id and guardian.guardian_id = new.parent_id
        )
      )
      and (
        c.year_of_birth is null
        or new.year_of_birth is null
        or c.year_of_birth = new.year_of_birth
      )
  ) then
    raise exception 'duplicate_child_for_parent: % is already in your children list', btrim(new.name)
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_child_for_parent_trg on public.children;
create trigger prevent_duplicate_child_for_parent_trg
before insert on public.children
for each row execute function public.prevent_duplicate_child_for_parent();

create or replace function public.create_child_for_parent_on_team(
  p_parent_user_id uuid,
  p_team_id uuid,
  p_name text,
  p_year_of_birth integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_id uuid;
  v_club_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Child name is required'; end if;

  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then raise exception 'Team not found'; end if;

  if not exists (
    select 1 from public.user_roles role
    where role.user_id = auth.uid()
      and (
        (role.team_id = p_team_id and role.role in ('team_admin', 'coach', 'app_admin'))
        or (role.club_id = v_club_id and role.role in ('club_admin', 'committee_member', 'app_admin'))
      )
  ) then
    raise exception 'Access denied';
  end if;

  select child.id into v_child_id
  from public.children child
  join public.child_team_assignments assignment on assignment.child_id = child.id
  where assignment.team_id = p_team_id
    and lower(btrim(child.name)) = lower(btrim(p_name))
  order by child.created_at
  limit 1;

  if v_child_id is not null then
    insert into public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    values (v_child_id, p_parent_user_id, 'parent', false)
    on conflict (child_id, guardian_id) do nothing;
    return v_child_id;
  end if;

  select child.id into v_child_id
  from public.children child
  where lower(btrim(child.name)) = lower(btrim(p_name))
    and (
      child.parent_id = p_parent_user_id
      or exists (
        select 1 from public.child_guardians guardian
        where guardian.child_id = child.id and guardian.guardian_id = p_parent_user_id
      )
    )
    and (
      child.year_of_birth is null
      or p_year_of_birth is null
      or child.year_of_birth = p_year_of_birth
    )
  order by child.created_at
  limit 1;

  if v_child_id is null then
    insert into public.children (parent_id, name, year_of_birth)
    values (p_parent_user_id, btrim(p_name), p_year_of_birth)
    returning id into v_child_id;
  end if;

  insert into public.child_team_assignments (child_id, team_id)
  values (v_child_id, p_team_id)
  on conflict (child_id, team_id) do nothing;

  return v_child_id;
end;
$$;

grant execute on function public.create_child_for_parent_on_team(uuid, uuid, text, integer)
to authenticated, service_role;

-- Production attributes a child response to the acting guardian, so both
-- user_id and child_id are present. The original local XOR check was stale.
alter table public.rsvps drop constraint if exists rsvps_check;
alter table public.rsvps
  add constraint rsvps_subject_required check (user_id is not null or child_id is not null);

drop policy if exists rsvps_self_insert on public.rsvps;
drop policy if exists rsvps_self_update on public.rsvps;
drop policy if exists rsvps_self_delete on public.rsvps;

create policy rsvps_self_insert on public.rsvps
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.events event
    where event.id = event_id and public.is_club_member(auth.uid(), event.club_id)
  )
);

create policy rsvps_self_update on public.rsvps
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy rsvps_self_delete on public.rsvps
for delete to authenticated
using (user_id = auth.uid());

create policy rsvps_guardian_insert on public.rsvps
for insert to authenticated
with check (
  child_id is not null
  and exists (
    select 1 from public.child_guardians guardian
    where guardian.child_id = rsvps.child_id and guardian.guardian_id = auth.uid()
  )
);

create policy rsvps_guardian_update on public.rsvps
for update to authenticated
using (
  child_id is not null
  and exists (
    select 1 from public.child_guardians guardian
    where guardian.child_id = rsvps.child_id and guardian.guardian_id = auth.uid()
  )
)
with check (
  child_id is not null
  and exists (
    select 1 from public.child_guardians guardian
    where guardian.child_id = rsvps.child_id and guardian.guardian_id = auth.uid()
  )
);

create policy rsvps_guardian_delete on public.rsvps
for delete to authenticated
using (
  child_id is not null
  and exists (
    select 1 from public.child_guardians guardian
    where guardian.child_id = rsvps.child_id and guardian.guardian_id = auth.uid()
  )
);
