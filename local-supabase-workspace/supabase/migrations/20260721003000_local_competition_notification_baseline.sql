-- LOCAL JOURNEY-TEST SCHEMA ONLY. NOT A DEPLOYMENT MIGRATION.
-- Minimal competition and notification contracts reconstructed from the
-- repository migrations. Contains no hosted identifiers or real user data.

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  organizer_club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'active', 'completed', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'withdrawn', 'removed')),
  invited_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, team_id)
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  events_enabled boolean not null default true,
  membership_enabled boolean not null default true,
  messages_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  type text not null,
  message text not null,
  related_id uuid,
  is_read boolean not null default false,
  skip_push boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index notifications_journey_dedup
  on public.notifications (user_id, type, related_id, message)
  where related_id is not null;

create or replace function public.can_organise_competition(_user_id uuid, _club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'app_admin')
    or public.has_role(_user_id, 'club_admin', _club_id, null)
    or public.has_role(_user_id, 'association_admin', _club_id, null);
$$;

create or replace function public.is_competition_admin(_user_id uuid, _competition_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competitions c
    where c.id = _competition_id
      and public.can_organise_competition(_user_id, c.organizer_club_id)
  );
$$;

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

alter table public.competitions enable row level security;
alter table public.competition_entries enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

create policy competitions_select on public.competitions for select
  using (public.can_view_competition(auth.uid(), id));
create policy competitions_insert on public.competitions for insert
  with check (created_by = auth.uid() and public.can_organise_competition(auth.uid(), organizer_club_id));
create policy competitions_update on public.competitions for update
  using (public.is_competition_admin(auth.uid(), id))
  with check (public.is_competition_admin(auth.uid(), id));
create policy competitions_delete on public.competitions for delete
  using (public.is_competition_admin(auth.uid(), id));

create policy competition_entries_select on public.competition_entries for select
  using (public.can_view_competition(auth.uid(), competition_id) or public.is_team_member(auth.uid(), team_id));
create policy competition_entries_insert on public.competition_entries for insert
  with check (public.is_competition_admin(auth.uid(), competition_id));
create policy competition_entries_update on public.competition_entries for update
  using (public.is_competition_admin(auth.uid(), competition_id) or public.has_role(auth.uid(), 'team_admin', null, team_id))
  with check (public.is_competition_admin(auth.uid(), competition_id) or public.has_role(auth.uid(), 'team_admin', null, team_id));
create policy competition_entries_delete on public.competition_entries for delete
  using (public.is_competition_admin(auth.uid(), competition_id));

create policy notification_preferences_own on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_select on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on public.notifications for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.competitions, public.competition_entries,
  public.notification_preferences, public.notifications to authenticated, service_role;
grant execute on function public.can_organise_competition(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_competition_admin(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_competition(uuid, uuid) to authenticated, service_role;
