-- Local-only parity for production migration
-- 20260809090816_4268fd0f-0146-478c-afbe-ecee7f2ade26.sql.
-- Synthetic fixtures use this table only to exercise the production helper's
-- excluded-member branch; it is not copied to or deployed against hosted data.
create table if not exists public.club_member_exclusions (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (club_id, user_id)
);

alter table public.club_member_exclusions enable row level security;

create or replace function public.can_publish_club_wide_photo(_user_id uuid, _club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id is not null and _club_id is not null and (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = _user_id and ur.role = 'app_admin'::public.app_role
    )
    or exists (
      select 1
      from public.user_roles ur
      left join public.teams t on t.id = ur.team_id
      where ur.user_id = _user_id
        and ur.role in (
          'club_admin'::public.app_role,
          'committee_member'::public.app_role,
          'team_admin'::public.app_role,
          'coach'::public.app_role
        )
        and (ur.club_id = _club_id or t.club_id = _club_id)
    )
  )
  and not exists (
    select 1 from public.club_member_exclusions cme
    where cme.club_id = _club_id and cme.user_id = _user_id
  );
$$;

grant execute on function public.can_publish_club_wide_photo(uuid, uuid)
  to authenticated, service_role;

drop policy if exists photos_member_insert on public.photos;
drop policy if exists "Members can upload photos" on public.photos;
drop policy if exists "Users can upload mini-league photos" on public.photos;
drop policy if exists "Scoped role-checked photo uploads" on public.photos;

create policy "Scoped role-checked photo uploads"
on public.photos
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and uploader_id = (select auth.uid())
  and (
    (
      team_id is null
      and mini_league_id is null
      and club_id is not null
      and public.can_publish_club_wide_photo((select auth.uid()), club_id)
    )
    or (
      team_id is not null
      and mini_league_id is null
      and exists (
        select 1 from public.teams t
        where t.id = photos.team_id
          and (photos.club_id is null or t.club_id = photos.club_id)
      )
      and (
        public.is_team_member((select auth.uid()), team_id)
        or public.has_role((select auth.uid()), 'team_admin'::public.app_role, null::uuid, team_id)
        or exists (
          select 1 from public.teams t
          where t.id = photos.team_id
            and (
              public.has_role((select auth.uid()), 'club_admin'::public.app_role, t.club_id, null::uuid)
              or public.has_role((select auth.uid()), 'app_admin'::public.app_role, null::uuid, null::uuid)
            )
        )
      )
    )
    or (
      mini_league_id is not null
      and team_id is null
      and exists (
        select 1 from public.mini_leagues ml
        where ml.id = photos.mini_league_id
          and (photos.club_id is null or ml.club_id = photos.club_id)
      )
      and (
        exists (
          select 1
          from public.user_roles ur
          join public.mini_leagues ml on ml.club_id = ur.club_id
          where ml.id = photos.mini_league_id
            and ur.user_id = (select auth.uid())
            and ur.role = any (array[
              'league_admin'::public.app_role,
              'coach'::public.app_role,
              'club_admin'::public.app_role,
              'app_admin'::public.app_role
            ])
        )
        or exists (
          select 1 from public.mini_league_players mlp
          where mlp.mini_league_id = photos.mini_league_id
            and mlp.parent_user_id = (select auth.uid())
        )
      )
    )
  )
);
