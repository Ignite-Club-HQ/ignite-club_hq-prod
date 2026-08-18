-- LOCAL SECURITY-TEST PARITY ONLY. NOT A DEPLOYMENT MIGRATION.
-- Minimal event-groups schema and current production RLS copied into the
-- isolated Docker baseline so authorization gaps can be detected safely.

alter table public.events
  add column if not exists mini_league_id uuid references public.mini_leagues(id) on delete set null;

create table public.mini_league_players (
  id uuid primary key default gen_random_uuid(),
  mini_league_id uuid not null references public.mini_leagues(id) on delete cascade,
  name text not null,
  ability_rating integer not null default 3,
  parent_user_id uuid references public.profiles(id) on delete set null,
  child_id uuid references public.children(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.event_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  ability_band text,
  pitch_name text,
  pitch_state jsonb default '{}'::jsonb,
  timer_state jsonb default '{}'::jsonb,
  display_order integer default 0,
  team_a_color text default '#ef4444',
  team_b_color text default '#3b82f6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_group_players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.event_groups(id) on delete cascade,
  player_id uuid not null references public.mini_league_players(id) on delete cascade,
  team text check (team in ('a', 'b')),
  created_at timestamptz not null default now(),
  unique (group_id, player_id)
);

alter table public.mini_league_players enable row level security;
alter table public.event_groups enable row level security;
alter table public.event_group_players enable row level security;

create policy local_mini_league_players_member_select on public.mini_league_players
for select using (
  exists (
    select 1 from public.mini_leagues ml
    where ml.id = mini_league_id
      and public.is_club_member(auth.uid(), ml.club_id)
  )
);

create policy local_event_groups_member_select on public.event_groups
for select using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and (
        public.is_club_member(auth.uid(), e.club_id)
        or exists (
          select 1 from public.mini_league_players mlp
          where mlp.mini_league_id = e.mini_league_id
            and mlp.parent_user_id = auth.uid()
        )
      )
  )
);

-- This intentionally mirrors the current production policy. Tests define the
-- expected application contract and will reveal any UI/RLS mismatch.
create policy local_event_groups_admin_all on public.event_groups
for all using (
  exists (
    select 1
    from public.events e
    join public.user_roles ur on ur.club_id = e.club_id
    where e.id = event_id
      and ur.user_id = auth.uid()
      and ur.role in ('club_admin', 'league_admin', 'app_admin')
  )
);

create policy local_event_group_players_member_select on public.event_group_players
for select using (
  exists (
    select 1
    from public.event_groups eg
    join public.events e on e.id = eg.event_id
    where eg.id = group_id
      and (
        public.is_club_member(auth.uid(), e.club_id)
        or exists (
          select 1 from public.mini_league_players mlp
          where mlp.mini_league_id = e.mini_league_id
            and mlp.parent_user_id = auth.uid()
        )
      )
  )
);

create policy local_event_group_players_admin_all on public.event_group_players
for all using (
  exists (
    select 1
    from public.event_groups eg
    join public.events e on e.id = eg.event_id
    join public.user_roles ur on ur.club_id = e.club_id
    where eg.id = group_id
      and ur.user_id = auth.uid()
      and ur.role in ('club_admin', 'league_admin', 'app_admin')
  )
);

-- Mirror the forward authorization hardening migration now present on main.
create or replace function public.can_manage_event_groups(_user_id uuid, _event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id is not null and _event_id is not null and (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = _user_id and ur.role = 'app_admin'::public.app_role
    )
    or exists (
      select 1
      from public.events e
      join public.user_roles ur on ur.user_id = _user_id
      where e.id = _event_id
        and ur.club_id = e.club_id
        and (
          ur.role in ('club_admin'::public.app_role, 'committee_member'::public.app_role, 'league_admin'::public.app_role)
          or (
            ur.role = 'coach'::public.app_role
            and ur.team_id is null
            and e.mini_league_id is not null
          )
        )
    )
  );
$$;

revoke all on function public.can_manage_event_groups(uuid, uuid) from public, anon;
grant execute on function public.can_manage_event_groups(uuid, uuid) to authenticated, service_role;

create or replace function public.event_group_player_scope_ok(_group_id uuid, _player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_groups eg
    join public.events e on e.id = eg.event_id
    join public.mini_league_players mlp on mlp.id = _player_id
    join public.mini_leagues ml on ml.id = mlp.mini_league_id
    where eg.id = _group_id
      and case
        when e.mini_league_id is not null then mlp.mini_league_id = e.mini_league_id
        else ml.club_id = e.club_id
      end
  );
$$;

revoke all on function public.event_group_player_scope_ok(uuid, uuid) from public, anon;
grant execute on function public.event_group_player_scope_ok(uuid, uuid) to authenticated, service_role;

drop policy local_event_groups_admin_all on public.event_groups;
create policy local_event_groups_manager_insert on public.event_groups
for insert to authenticated
with check (public.can_manage_event_groups(auth.uid(), event_id));
create policy local_event_groups_manager_update on public.event_groups
for update to authenticated
using (public.can_manage_event_groups(auth.uid(), event_id))
with check (public.can_manage_event_groups(auth.uid(), event_id));
create policy local_event_groups_manager_delete on public.event_groups
for delete to authenticated
using (public.can_manage_event_groups(auth.uid(), event_id));

drop policy local_event_group_players_admin_all on public.event_group_players;
create policy local_event_group_players_manager_insert on public.event_group_players
for insert to authenticated
with check (
  exists (
    select 1 from public.event_groups eg
    where eg.id = event_group_players.group_id
      and public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
  and public.event_group_player_scope_ok(event_group_players.group_id, event_group_players.player_id)
);
create policy local_event_group_players_manager_update on public.event_group_players
for update to authenticated
using (
  exists (
    select 1 from public.event_groups eg
    where eg.id = event_group_players.group_id
      and public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
)
with check (
  exists (
    select 1 from public.event_groups eg
    where eg.id = event_group_players.group_id
      and public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
  and public.event_group_player_scope_ok(event_group_players.group_id, event_group_players.player_id)
);
create policy local_event_group_players_manager_delete on public.event_group_players
for delete to authenticated
using (
  exists (
    select 1 from public.event_groups eg
    where eg.id = event_group_players.group_id
      and public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
);

create or replace function public.swap_event_group_players(
  p_player1_id uuid,
  p_player1_group_id uuid,
  p_player1_team text,
  p_player2_id uuid,
  p_player2_group_id uuid,
  p_player2_team text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_player1_team is not null and p_player1_team not in ('a', 'b') then
    raise exception 'Invalid team value: %', p_player1_team;
  end if;
  if p_player2_team is not null and p_player2_team not in ('a', 'b') then
    raise exception 'Invalid team value: %', p_player2_team;
  end if;

  if p_player1_group_id = p_player2_group_id then
    update public.event_group_players set team = p_player2_team
      where group_id = p_player1_group_id and player_id = p_player1_id;
    if not found then raise exception 'Player not found in group'; end if;
    update public.event_group_players set team = p_player1_team
      where group_id = p_player2_group_id and player_id = p_player2_id;
    if not found then raise exception 'Player not found in group'; end if;
  else
    delete from public.event_group_players
      where group_id = p_player1_group_id and player_id = p_player1_id;
    if not found then raise exception 'Player not found in group'; end if;
    delete from public.event_group_players
      where group_id = p_player2_group_id and player_id = p_player2_id;
    if not found then raise exception 'Player not found in group'; end if;
    insert into public.event_group_players (group_id, player_id, team)
      values (p_player2_group_id, p_player1_id, p_player2_team);
    insert into public.event_group_players (group_id, player_id, team)
      values (p_player1_group_id, p_player2_id, p_player1_team);
  end if;
end;
$$;

revoke all on function public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) from public;
grant execute on function public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) to authenticated, service_role;

grant select, insert, update, delete on public.mini_league_players,
  public.event_groups, public.event_group_players to authenticated, service_role;

create index local_event_groups_event_id_idx on public.event_groups(event_id);
create index local_event_group_players_group_id_idx on public.event_group_players(group_id);
