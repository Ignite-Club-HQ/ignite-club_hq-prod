-- LOCAL JOURNEY-TEST SCHEMA ONLY. NOT A DEPLOYMENT MIGRATION.
-- Reproduces the production owner-role trigger required for an organiser to
-- read a newly inserted private competition through INSERT ... RETURNING.

create table public.competition_roles (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'referee', 'scorer')),
  created_at timestamptz not null default now(),
  unique (competition_id, user_id, role)
);

create or replace function public.is_competition_admin(_user_id uuid, _competition_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competition_roles cr
    where cr.competition_id = _competition_id
      and cr.user_id = _user_id
      and cr.role in ('owner', 'admin')
  ) or exists (
    select 1 from public.competitions c
    where c.id = _competition_id
      and public.can_organise_competition(_user_id, c.organizer_club_id)
  );
$$;

create or replace function public.create_competition_owner_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.competition_roles (competition_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger trg_competitions_create_owner_role
  after insert on public.competitions
  for each row execute function public.create_competition_owner_role();

alter table public.competition_roles enable row level security;
create policy competition_roles_select on public.competition_roles for select
  using (public.can_view_competition(auth.uid(), competition_id));
create policy competition_roles_manage on public.competition_roles for all
  using (public.is_competition_admin(auth.uid(), competition_id))
  with check (public.is_competition_admin(auth.uid(), competition_id));

grant select, insert, update, delete on public.competition_roles to authenticated, service_role;
grant execute on function public.create_competition_owner_role() to service_role;
