-- LOCAL SECURITY-TEST PARITY ONLY. NOT A DEPLOYMENT MIGRATION.
-- Synthetic representation of the club_links schema and hardened RLS policies.

create or replace function public.is_club_admin_for(_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and (
        (ur.role = 'club_admin' and ur.club_id = _club_id)
        or ur.role = 'app_admin'
      )
  );
$$;

grant execute on function public.is_club_admin_for(uuid) to authenticated, service_role;

create table public.club_links (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  subtitle text,
  url text not null,
  icon text not null default 'link',
  open_mode text not null default 'browser',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index club_links_club_idx on public.club_links (club_id, is_active, sort_order);
alter table public.club_links enable row level security;

create policy club_links_admin_insert on public.club_links
  for insert to authenticated
  with check (public.is_club_admin_for(club_id));

create policy club_links_admin_update on public.club_links
  for update to authenticated
  using (public.is_club_admin_for(club_id))
  with check (public.is_club_admin_for(club_id));

create policy club_links_admin_delete on public.club_links
  for delete to authenticated
  using (public.is_club_admin_for(club_id));

create policy club_links_admin_select on public.club_links
  for select to authenticated
  using (public.is_club_admin_for(club_id));

create policy club_links_member_active_select on public.club_links
  for select to authenticated
  using (
    is_active
    and (
      public.is_club_member(auth.uid(), club_id)
      or public.is_club_admin_for(club_id)
    )
  );

grant select, insert, update, delete on public.club_links to authenticated, service_role;
