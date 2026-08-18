-- LOCAL TEST-ONLY SEASON ROLLOVER CONTRACT. NOT A DEPLOYMENT MIGRATION.
-- This deliberately mirrors the production season RPC behaviour so isolated
-- journeys can detect regressions without connecting to a hosted project.

create type public.season_status as enum ('draft', 'active', 'closed', 'archived');
create type public.team_lifecycle_status as enum ('draft', 'active', 'archived');
create type public.team_membership_role as enum ('player', 'coach', 'team_admin');
create type public.team_membership_status as enum ('active', 'removed');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  status public.season_status not null default 'draft',
  start_date date,
  end_date date,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.club_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  child_id uuid references public.children(id) on delete set null,
  display_name text not null,
  date_of_birth date,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_id is not null or child_id is not null),
  unique (club_id, profile_id),
  unique (club_id, child_id)
);

alter table public.teams
  add column season_id uuid references public.seasons(id) on delete set null,
  add column lifecycle_status public.team_lifecycle_status not null default 'active',
  add column archived_at timestamptz,
  add column deleted_at timestamptz,
  add column level_age text,
  add column team_type text,
  add column default_pitch_format text,
  add column default_formation text;

alter table public.clubs
  add column current_season_id uuid references public.seasons(id) on delete set null;

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  club_player_id uuid not null references public.club_players(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  role public.team_membership_role not null default 'player',
  status public.team_membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_player_id, team_id, season_id)
);

alter table public.seasons enable row level security;
alter table public.club_players enable row level security;
alter table public.team_memberships enable row level security;

create or replace function public.is_club_admin(_user_id uuid, _club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'app_admin')
    or public.has_role(_user_id, 'club_admin', _club_id);
$$;

create policy "Club members can view seasons" on public.seasons for select to authenticated
using (public.is_club_member(auth.uid(), club_id) or public.has_role(auth.uid(), 'app_admin'));
create policy "Club admins can manage seasons" on public.seasons for all to authenticated
using (public.is_club_admin(auth.uid(), club_id)) with check (public.is_club_admin(auth.uid(), club_id));

create policy "Club members can view club players" on public.club_players for select to authenticated
using (public.is_club_member(auth.uid(), club_id) or public.has_role(auth.uid(), 'app_admin'));
create policy "Club admins can manage club players" on public.club_players for all to authenticated
using (public.is_club_admin(auth.uid(), club_id)) with check (public.is_club_admin(auth.uid(), club_id));

create policy "Club members can view team memberships" on public.team_memberships for select to authenticated
using (exists (
  select 1 from public.teams t where t.id = team_id
    and (public.is_club_member(auth.uid(), t.club_id) or public.has_role(auth.uid(), 'app_admin'))
));
create policy "Club admins can manage team memberships" on public.team_memberships for all to authenticated
using (exists (select 1 from public.teams t where t.id = team_id and public.is_club_admin(auth.uid(), t.club_id)))
with check (exists (select 1 from public.teams t where t.id = team_id and public.is_club_admin(auth.uid(), t.club_id)));

create or replace function public.archive_season(_season_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _club_id uuid;
begin
  select club_id into _club_id from public.seasons where id = _season_id;
  if _club_id is null then raise exception 'Season not found'; end if;
  if not public.is_club_admin(auth.uid(), _club_id) then
    raise exception 'Only club admins can archive seasons';
  end if;
  update public.seasons set status = 'archived', archived_at = now() where id = _season_id;
  update public.teams set lifecycle_status = 'archived', is_archived = true,
    archived_at = coalesce(archived_at, now()) where season_id = _season_id;
  update public.clubs set current_season_id = null where current_season_id = _season_id;
end;
$$;

create or replace function public.duplicate_season_structure(
  _source_season_id uuid, _new_season_name text, _copy_staff boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare _club_id uuid; _new_season_id uuid; _team_rec record; _new_team_id uuid;
begin
  select club_id into _club_id from public.seasons where id = _source_season_id;
  if _club_id is null then raise exception 'Source season not found'; end if;
  if not public.is_club_admin(auth.uid(), _club_id) then
    raise exception 'Only club admins can create seasons';
  end if;
  insert into public.seasons (club_id, name, status, created_by)
  values (_club_id, _new_season_name, 'draft', auth.uid()) returning id into _new_season_id;
  for _team_rec in
    select id, name, level_age, team_type, club_id, default_pitch_format, default_formation
    from public.teams where season_id = _source_season_id and coalesce(is_archived, false) = false
  loop
    insert into public.teams (
      club_id, name, level_age, team_type, season_id, lifecycle_status,
      default_pitch_format, default_formation, created_by
    ) values (
      _team_rec.club_id, _team_rec.name, _team_rec.level_age, _team_rec.team_type,
      _new_season_id, 'draft', _team_rec.default_pitch_format,
      _team_rec.default_formation, auth.uid()
    ) returning id into _new_team_id;
    if _copy_staff then
      insert into public.user_roles (user_id, role, team_id, club_id)
      select distinct user_id, role, _new_team_id, _team_rec.club_id
      from public.user_roles where team_id = _team_rec.id and role in ('team_admin', 'coach')
      on conflict do nothing;
    end if;
  end loop;
  return _new_season_id;
end;
$$;

create or replace function public.get_returning_players(_source_season_id uuid)
returns table (
  club_player_id uuid, display_name text, date_of_birth date, age_years int,
  previous_team_id uuid, previous_team_name text, membership_role public.team_membership_role
) language sql stable security definer set search_path = public as $$
  select cp.id, cp.display_name, cp.date_of_birth,
    case when cp.date_of_birth is not null then extract(year from age(cp.date_of_birth))::int else null end,
    t.id, t.name, tm.role
  from public.team_memberships tm
  join public.club_players cp on cp.id = tm.club_player_id
  join public.teams t on t.id = tm.team_id
  where tm.season_id = _source_season_id and tm.status = 'active' and cp.is_active = true
    and public.is_club_admin(auth.uid(), cp.club_id)
  order by t.name, cp.display_name;
$$;

create or replace function public.carry_over_players_to_teams(
  _target_season_id uuid, _assignments jsonb
) returns int language plpgsql security definer set search_path = public as $$
declare _club_id uuid; _inserted int := 0;
begin
  select club_id into _club_id from public.seasons where id = _target_season_id;
  if _club_id is null then raise exception 'Target season not found'; end if;
  if not public.is_club_admin(auth.uid(), _club_id) then
    raise exception 'Not authorized to carry over players';
  end if;
  with parsed as (
    select (elem->>'club_player_id')::uuid club_player_id,
      nullif(elem->>'team_id', '')::uuid team_id
    from jsonb_array_elements(coalesce(_assignments, '[]'::jsonb)) elem
  ), valid as (
    select distinct p.club_player_id, p.team_id from parsed p
    join public.teams t on t.id = p.team_id and t.season_id = _target_season_id
      and t.club_id = _club_id and t.deleted_at is null
    join public.club_players cp on cp.id = p.club_player_id and cp.club_id = _club_id
  ), ins as (
    insert into public.team_memberships (club_player_id, team_id, season_id, role, status, created_by)
    select club_player_id, team_id, _target_season_id, 'player', 'active', auth.uid() from valid
    on conflict (club_player_id, team_id, season_id) do nothing returning 1
  ) select count(*) into _inserted from ins;
  return _inserted;
end;
$$;

create or replace function public.publish_season(_season_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _club_id uuid;
begin
  select club_id into _club_id from public.seasons where id = _season_id;
  if _club_id is null then raise exception 'Season not found'; end if;
  if not public.is_club_admin(auth.uid(), _club_id) then
    raise exception 'Only club admins can publish seasons';
  end if;
  update public.seasons set status = 'active' where id = _season_id and status = 'draft';
  update public.teams set lifecycle_status = 'active'
    where season_id = _season_id and lifecycle_status = 'draft';
  update public.clubs set current_season_id = _season_id where id = _club_id;
end;
$$;

grant execute on function public.archive_season(uuid) to authenticated;
grant execute on function public.duplicate_season_structure(uuid, text, boolean) to authenticated;
grant execute on function public.get_returning_players(uuid) to authenticated;
grant execute on function public.carry_over_players_to_teams(uuid, jsonb) to authenticated;
grant execute on function public.publish_season(uuid) to authenticated;
