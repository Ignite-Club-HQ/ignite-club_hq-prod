-- Synthetic local mirror of the production event/team club-scope invariant.
-- This migration belongs only to the isolated Docker test workspace.

create or replace function public.validate_event_team_club_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_club uuid;
begin
  if new.team_id is null then
    return new;
  end if;

  select club_id into team_club
  from public.teams
  where id = new.team_id;

  if team_club is null then
    raise exception 'Event references a team that does not exist (team_id=%).', new.team_id
      using errcode = 'foreign_key_violation';
  end if;

  if team_club <> new.club_id then
    raise exception
      'Selected team does not belong to the selected club (team % is in club %, event uses club %).',
      new.team_id, team_club, new.club_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_event_scope on public.events;
create trigger trg_validate_event_scope
before insert or update of team_id, club_id
on public.events
for each row
execute function public.validate_event_team_club_scope();

comment on function public.validate_event_team_club_scope() is
  'Synthetic local mirror: rejects events whose team belongs to another club.';
