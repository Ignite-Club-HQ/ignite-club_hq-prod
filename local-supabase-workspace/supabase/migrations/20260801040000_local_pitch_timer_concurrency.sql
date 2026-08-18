-- LOCAL TEST INFRASTRUCTURE ONLY. Minimal active-game surface required to
-- exercise the production pitch-timer Edge Function with synthetic users.

create table if not exists public.active_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  is_active boolean not null default true,
  timer_state jsonb,
  pitch_state jsonb,
  last_sub_check_time integer not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists active_games_one_active_team
  on public.active_games (team_id)
  where is_active and team_id is not null;

create unique index if not exists active_games_one_active_personal
  on public.active_games (user_id)
  where is_active and team_id is null;

alter table public.active_games enable row level security;

create policy active_games_team_members_read_local
  on public.active_games for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.team_id = active_games.team_id
    )
  );

create or replace function public.can_control_pitch_board(
  _team_id uuid,
  _event_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    join public.user_roles ur on ur.user_id = auth.uid()
    where t.id = _team_id
      and (
        ur.role = 'app_admin'
        or (ur.team_id = t.id and ur.role in ('team_admin', 'coach'))
        or (ur.club_id = t.club_id and ur.role in ('club_admin', 'committee_member'))
      )
  );
$$;

grant execute on function public.can_control_pitch_board(uuid, uuid) to authenticated;
