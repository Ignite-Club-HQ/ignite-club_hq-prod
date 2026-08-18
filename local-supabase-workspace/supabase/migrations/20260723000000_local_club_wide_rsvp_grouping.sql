-- LOCAL SECURITY-TEST PARITY ONLY. Mirrors the repository feature migration
-- and current committee event policy without touching any hosted project.
alter table public.events add column if not exists rsvp_grouping text;
alter table public.events drop constraint if exists events_rsvp_grouping_check;
alter table public.events add constraint events_rsvp_grouping_check
  check (rsvp_grouping is null or rsvp_grouping in ('level', 'team'));

create or replace function public.validate_event_rsvp_grouping()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.rsvp_grouping is not null and new.team_id is not null then
    raise exception 'rsvp_grouping can only be set on club-wide events (team_id must be NULL)';
  end if;
  return new;
end;
$$;

create trigger trg_validate_event_rsvp_grouping
before insert or update of rsvp_grouping, team_id on public.events
for each row execute function public.validate_event_rsvp_grouping();

drop policy events_admin_insert on public.events;
create policy events_admin_insert on public.events for insert with check (
  created_by = auth.uid() and (
    public.has_role(auth.uid(), 'club_admin', club_id, null)
    or (team_id is not null and (
      public.has_role(auth.uid(), 'team_admin', null, team_id)
      or public.has_role(auth.uid(), 'coach', null, team_id)
    ))
    or (
      public.has_role(auth.uid(), 'committee_member', club_id, null)
      and type in ('social', 'game') and team_id is null
    )
  )
);

drop policy events_admin_update on public.events;
create policy events_admin_update on public.events for update using (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (team_id is not null and (
    public.has_role(auth.uid(), 'team_admin', null, team_id)
    or public.has_role(auth.uid(), 'coach', null, team_id)
  ))
  or (
    public.has_role(auth.uid(), 'committee_member', club_id, null)
    and type in ('social', 'game') and team_id is null
  )
) with check (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (team_id is not null and (
    public.has_role(auth.uid(), 'team_admin', null, team_id)
    or public.has_role(auth.uid(), 'coach', null, team_id)
  ))
  or (
    public.has_role(auth.uid(), 'committee_member', club_id, null)
    and type in ('social', 'game') and team_id is null
  )
);
