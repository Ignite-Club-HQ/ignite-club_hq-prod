-- LOCAL JOURNEY-TEST SCHEMA ONLY. NOT A DEPLOYMENT MIGRATION.
-- Minimal parity for the competition creator-visibility and scoped guardian
-- removal contracts already implemented in the hosted migration history.

create table public.team_member_exclusions (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null,
  excluded_at timestamptz not null default now(),
  excluded_by uuid,
  primary key (team_id, user_id)
);

alter table public.team_member_exclusions enable row level security;

create policy team_exclusions_admin_select on public.team_member_exclusions for select
  using (
    public.has_role(auth.uid(), 'app_admin')
    or public.has_role(auth.uid(), 'team_admin', null, team_id)
    or exists (
      select 1 from public.teams t
      where t.id = team_id and public.has_role(auth.uid(), 'club_admin', t.club_id, null)
    )
  );

create or replace function public.is_team_member(_user_id uuid, _team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    exists (select 1 from public.user_roles where user_id = _user_id and team_id = _team_id)
    or exists (
      select 1 from public.child_team_assignments cta join public.children c on c.id = cta.child_id
      where cta.team_id = _team_id and c.parent_id = _user_id
    )
    or exists (
      select 1 from public.child_team_assignments cta join public.child_guardians cg on cg.child_id = cta.child_id
      where cta.team_id = _team_id and cg.guardian_id = _user_id
    )
  ) and not exists (
    select 1 from public.team_member_exclusions
    where team_id = _team_id and user_id = _user_id
  );
$$;

create or replace function public.is_club_member(_user_id uuid, _club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and club_id = _club_id)
  or exists (
    select 1 from public.user_roles ur join public.teams t on t.id = ur.team_id
    where ur.user_id = _user_id and t.club_id = _club_id
  )
  or exists (
    select 1 from public.child_team_assignments cta join public.teams t on t.id = cta.team_id
    join public.children c on c.id = cta.child_id
    where t.club_id = _club_id and c.parent_id = _user_id
      and not exists (
        select 1 from public.team_member_exclusions
        where team_id = cta.team_id and user_id = _user_id
      )
  )
  or exists (
    select 1 from public.child_team_assignments cta join public.teams t on t.id = cta.team_id
    join public.child_guardians cg on cg.child_id = cta.child_id
    where t.club_id = _club_id and cg.guardian_id = _user_id
      and not exists (
        select 1 from public.team_member_exclusions
        where team_id = cta.team_id and user_id = _user_id
      )
  );
$$;

create or replace function public.remove_team_member(_team_id uuid, _user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_club_id uuid;
  v_roles_removed integer := 0;
  v_exclusion_added boolean := false;
begin
  if v_caller is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select club_id into v_club_id from public.teams where id = _team_id;
  if v_club_id is null then raise exception 'Team not found' using errcode = 'P0002'; end if;
  if not (
    public.has_role(v_caller, 'app_admin')
    or public.has_role(v_caller, 'club_admin', v_club_id, null)
    or public.has_role(v_caller, 'team_admin', null, _team_id)
  ) then
    raise exception 'Not authorised to remove members from this team' using errcode = '42501';
  end if;

  with deleted as (
    delete from public.user_roles where user_id = _user_id and team_id = _team_id returning 1
  ) select count(*) into v_roles_removed from deleted;

  insert into public.team_member_exclusions (team_id, user_id, excluded_by)
  values (_team_id, _user_id, v_caller) on conflict do nothing;
  get diagnostics v_exclusion_added = row_count;

  return jsonb_build_object(
    'roles_removed', v_roles_removed,
    'exclusion_added', v_exclusion_added,
    'group_memberships_removed', 0
  );
end;
$$;

revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
grant select on public.team_member_exclusions to authenticated, service_role;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated, service_role;

create or replace function public.can_view_competition(_user_id uuid, _competition_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competitions c
    where c.id = _competition_id and (
      c.visibility = 'public'
      or public.is_competition_admin(_user_id, c.id)
      or exists (
        select 1 from public.competition_entries ce
        where ce.competition_id = c.id and public.is_team_member(_user_id, ce.team_id)
      )
    )
  );
$$;

-- INSERT ... RETURNING must evaluate creator visibility directly against the
-- new row rather than through a helper subquery over public.competitions.
drop policy if exists competitions_select on public.competitions;
create policy competitions_select on public.competitions for select
  using (
    created_by = (select auth.uid())
    or public.can_view_competition((select auth.uid()), id)
  );
