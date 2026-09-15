-- LOCAL TEST-ONLY PARITY MIGRATION. NOT A DEPLOYMENT MIGRATION.
-- Mirrors production migration 20260729070345 so the isolated journey proves
-- the archive-then-duplicate fix without connecting to a hosted project.

create or replace function public.duplicate_season_structure(
  _source_season_id uuid,
  _new_season_name text,
  _copy_staff boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _club_id uuid;
  _new_season_id uuid;
  _team_rec record;
  _new_team_id uuid;
begin
  select club_id into _club_id from public.seasons where id = _source_season_id;
  if _club_id is null then
    raise exception 'Source season not found';
  end if;

  if not public.is_club_admin(auth.uid(), _club_id) then
    raise exception 'Only club admins can create seasons';
  end if;

  insert into public.seasons (club_id, name, status, created_by)
  values (_club_id, _new_season_name, 'draft', auth.uid())
  returning id into _new_season_id;

  for _team_rec in
    select id, name, level_age, team_type, club_id, default_pitch_format, default_formation
    from public.teams
    where season_id = _source_season_id
      and deleted_at is null
      and club_id = _club_id
    order by created_at
  loop
    insert into public.teams (
      club_id, name, level_age, team_type, season_id, lifecycle_status,
      is_archived, archived_at, deleted_at,
      default_pitch_format, default_formation, created_by
    ) values (
      _club_id, _team_rec.name, _team_rec.level_age, _team_rec.team_type,
      _new_season_id, 'draft', false, null, null,
      _team_rec.default_pitch_format, _team_rec.default_formation, auth.uid()
    ) returning id into _new_team_id;

    if _copy_staff then
      insert into public.user_roles (user_id, role, team_id, club_id)
      select distinct user_id, role, _new_team_id, _club_id
      from public.user_roles
      where team_id = _team_rec.id
        and role in ('team_admin', 'coach')
      on conflict do nothing;
    end if;
  end loop;

  return _new_season_id;
end;
$$;
