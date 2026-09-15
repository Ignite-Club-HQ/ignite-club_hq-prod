-- LOCAL SECURITY-TEST BASELINE ONLY. NOT A DEPLOYMENT MIGRATION.
-- Minimal schema reconstructed from src/integrations/supabase/types.ts and the
-- latest relevant repository migrations. It intentionally excludes historical
-- data corrections, real UUIDs, club names, and unrelated product features.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists local_test;
revoke all on schema local_test from public, anon, authenticated;

create table local_test.environment_marker (
  id uuid primary key,
  purpose text not null check (purpose = 'ignite-club-local-security-tests')
);

create type public.app_role as enum (
  'basic_user', 'club_admin', 'team_admin', 'coach', 'player', 'parent',
  'app_admin', 'league_admin', 'committee_member', 'association_admin',
  'competition_admin'
);
create type public.club_subscription_plan as enum ('starter', 'standard', 'unlimited');
create type public.event_type as enum ('game', 'training', 'social', 'mini_league');
create type public.rsvp_status as enum ('going', 'maybe', 'not_going');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  is_pro boolean not null default false,
  subscription_expiry timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  age_group text,
  created_by uuid references auth.users(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  club_id uuid references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (club_id is not null or team_id is not null or role = 'app_admin')
);
create unique index user_roles_exact_scope_unique
  on public.user_roles (user_id, role, coalesce(club_id, '00000000-0000-0000-0000-000000000000'), coalesce(team_id, '00000000-0000-0000-0000-000000000000'));

create table public.club_subscriptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null unique references public.clubs(id) on delete cascade,
  plan public.club_subscription_plan not null default 'starter',
  is_pro boolean not null default false,
  is_pro_football boolean not null default false,
  admin_pro_override boolean not null default false,
  admin_pro_football_override boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  year_of_birth integer,
  created_at timestamptz not null default now()
);

create table public.child_guardians (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  relationship_type text default 'parent',
  is_primary boolean default false,
  created_at timestamptz not null default now(),
  unique (child_id, guardian_id)
);

create table public.child_team_assignments (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (child_id, team_id)
);

create table public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  role public.app_role not null,
  invited_by_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_user_id uuid references public.profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  invite_token text unique,
  metadata jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  type public.event_type not null default 'social',
  event_date timestamptz not null,
  description text,
  is_cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade,
  status public.rsvp_status not null,
  source text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((user_id is not null)::integer + (child_id is not null)::integer = 1)
);
create unique index rsvps_user_event_unique on public.rsvps (event_id, user_id) where user_id is not null;
create unique index rsvps_child_event_unique on public.rsvps (event_id, child_id) where child_id is not null;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  file_url text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- The local Supabase platform creates this publication. Add only the two
-- security-sensitive tables needed by the designed Realtime integration suite.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
    ) then
      alter publication supabase_realtime add table public.events;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_roles'
    ) then
      alter publication supabase_realtime add table public.user_roles;
    end if;
  end if;
end;
$$;

create or replace function public.has_role(
  _user_id uuid, _role public.app_role, _club_id uuid default null, _team_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = _user_id and ur.role = _role
      and (_club_id is null or ur.club_id = _club_id)
      and (_team_id is null or ur.team_id = _team_id)
  );
$$;

create or replace function public.is_team_member(_user_id uuid, _team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and team_id = _team_id)
  or exists (
    select 1 from public.child_team_assignments cta join public.children c on c.id = cta.child_id
    where cta.team_id = _team_id and c.parent_id = _user_id
  )
  or exists (
    select 1 from public.child_team_assignments cta join public.child_guardians cg on cg.child_id = cta.child_id
    where cta.team_id = _team_id and cg.guardian_id = _user_id
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
  )
  or exists (
    select 1 from public.child_team_assignments cta join public.teams t on t.id = cta.team_id
    join public.child_guardians cg on cg.child_id = cta.child_id
    where t.club_id = _club_id and cg.guardian_id = _user_id
  );
$$;

create or replace function public.is_child_parent(_user_id uuid, _child_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.children where id = _child_id and parent_id = _user_id);
$$;

create or replace function public.is_child_guardian(_user_id uuid, _child_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.child_guardians where child_id = _child_id and guardian_id = _user_id);
$$;

create or replace function public.has_active_pro_for_club(_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (is_pro or is_pro_football or admin_pro_override or admin_pro_football_override)
      and (expires_at is null or expires_at > now())
    from public.club_subscriptions where club_id = _club_id
  ), false);
$$;

create or replace function public.has_active_pro_for_team(_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.has_active_pro_for_club((select club_id from public.teams where id = _team_id)), false);
$$;

create or replace function public.user_has_any_club_pro(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clubs c where public.is_club_member(_user_id, c.id)
      and public.has_active_pro_for_club(c.id)
  );
$$;

create or replace function public.is_local_security_test_environment()
returns boolean language sql stable security definer set search_path = local_test, public as $$
  select exists (
    select 1 from local_test.environment_marker
    where purpose = 'ignite-club-local-security-tests'
  );
$$;

-- Atomic guardian invitation acceptance. All required writes share one DB
-- transaction; any exception rolls back both the role and guardian link.
create or replace function public.accept_guardian_invite(_invite_id uuid, _child_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invite public.pending_invites%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into v_invite from public.pending_invites where id = _invite_id for update;
  if not found or v_invite.status <> 'pending' or v_invite.invited_user_id is distinct from v_user then
    raise exception 'invite is not available to this user';
  end if;
  if v_invite.role <> 'parent' then raise exception 'invite is not a parent invitation'; end if;
  if not exists (select 1 from public.children where id = _child_id) then
    raise exception 'invited child does not exist';
  end if;

  insert into public.user_roles (user_id, role, club_id, team_id)
  values (v_user, 'parent', v_invite.club_id, v_invite.team_id)
  on conflict do nothing;

  insert into public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
  values (_child_id, v_user, 'parent', false)
  on conflict (child_id, guardian_id) do nothing;

  update public.pending_invites
  set status = 'accepted', accepted_at = now()
  where id = _invite_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.teams enable row level security;
alter table public.user_roles enable row level security;
alter table public.club_subscriptions enable row level security;
alter table public.children enable row level security;
alter table public.child_guardians enable row level security;
alter table public.child_team_assignments enable row level security;
alter table public.pending_invites enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;
alter table public.photos enable row level security;

create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy clubs_member_select on public.clubs for select using (public.is_club_member(auth.uid(), id));
create policy teams_member_select on public.teams for select using (public.is_team_member(auth.uid(), id) or public.is_club_member(auth.uid(), club_id));
create policy roles_visible_to_self_or_admin on public.user_roles for select using (
  user_id = auth.uid() or public.has_role(auth.uid(), 'app_admin')
  or (club_id is not null and public.has_role(auth.uid(), 'club_admin', club_id, null))
  or (team_id is not null and (public.has_role(auth.uid(), 'team_admin', null, team_id) or public.has_role(auth.uid(), 'coach', null, team_id)))
);
create policy roles_admin_insert on public.user_roles for insert with check (
  public.has_role(auth.uid(), 'app_admin')
  or (club_id is not null and public.has_role(auth.uid(), 'club_admin', club_id, null))
  or (team_id is not null and public.has_role(auth.uid(), 'team_admin', null, team_id))
);
create policy roles_admin_update on public.user_roles for update using (
  public.has_role(auth.uid(), 'app_admin')
  or (club_id is not null and public.has_role(auth.uid(), 'club_admin', club_id, null))
  or (team_id is not null and public.has_role(auth.uid(), 'team_admin', null, team_id))
) with check (
  public.has_role(auth.uid(), 'app_admin')
  or (club_id is not null and public.has_role(auth.uid(), 'club_admin', club_id, null))
  or (team_id is not null and public.has_role(auth.uid(), 'team_admin', null, team_id))
);
create policy roles_admin_delete on public.user_roles for delete using (
  public.has_role(auth.uid(), 'app_admin')
  or (club_id is not null and public.has_role(auth.uid(), 'club_admin', club_id, null))
  or (team_id is not null and public.has_role(auth.uid(), 'team_admin', null, team_id))
);
create policy subscriptions_member_select on public.club_subscriptions for select using (public.is_club_member(auth.uid(), club_id));
create policy children_family_select on public.children for select using (
  parent_id = auth.uid() or public.is_child_guardian(auth.uid(), id)
);
create policy guardians_family_select on public.child_guardians for select using (
  guardian_id = auth.uid() or public.is_child_parent(auth.uid(), child_id)
);
create policy assignments_team_member_select on public.child_team_assignments for select using (public.is_team_member(auth.uid(), team_id));
create policy invites_owner_select on public.pending_invites for select using (invited_user_id = auth.uid() or invited_by_user_id = auth.uid());
create policy events_member_select on public.events for select using (public.is_club_member(auth.uid(), club_id));
create policy events_admin_insert on public.events for insert with check (
  created_by = auth.uid() and (
    public.has_role(auth.uid(), 'club_admin', club_id, null)
    or (team_id is not null and (public.has_role(auth.uid(), 'team_admin', null, team_id) or public.has_role(auth.uid(), 'coach', null, team_id)))
  )
);
create policy events_admin_update on public.events for update using (
  public.has_role(auth.uid(), 'club_admin', club_id, null)
  or (team_id is not null and (public.has_role(auth.uid(), 'team_admin', null, team_id) or public.has_role(auth.uid(), 'coach', null, team_id)))
);
create policy rsvps_member_select on public.rsvps for select using (
  user_id = auth.uid() or exists (select 1 from public.events e where e.id = event_id and public.is_club_member(auth.uid(), e.club_id))
);
create policy rsvps_self_insert on public.rsvps for insert with check (
  user_id = auth.uid() and exists (select 1 from public.events e where e.id = event_id and public.is_club_member(auth.uid(), e.club_id))
);
create policy rsvps_self_update on public.rsvps for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rsvps_self_delete on public.rsvps for delete using (user_id = auth.uid());
create policy photos_member_select on public.photos for select using (
  public.is_club_member(auth.uid(), club_id) and (team_id is null or public.is_team_member(auth.uid(), team_id))
);
create policy photos_member_insert on public.photos for insert with check (
  uploader_id = auth.uid() and public.is_club_member(auth.uid(), club_id)
  and (team_id is null or public.is_team_member(auth.uid(), team_id))
);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function public.has_role(uuid, public.app_role, uuid, uuid) to authenticated, service_role;
grant execute on function public.is_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_club_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_child_parent(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_child_guardian(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_active_pro_for_club(uuid) to authenticated, service_role;
grant execute on function public.has_active_pro_for_team(uuid) to authenticated, service_role;
grant execute on function public.user_has_any_club_pro(uuid) to authenticated, service_role;
grant execute on function public.accept_guardian_invite(uuid, uuid) to authenticated;
revoke all on function public.is_local_security_test_environment() from public, anon, authenticated;
grant execute on function public.is_local_security_test_environment() to service_role;
