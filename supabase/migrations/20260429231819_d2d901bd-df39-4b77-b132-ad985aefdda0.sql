
create table if not exists public.dm_attachment_restrictions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('club','user')),
  club_id uuid references public.clubs(id) on delete cascade,
  user_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint dm_restriction_scope_check check (
    (scope = 'club' and club_id is not null and user_id is null) or
    (scope = 'user' and user_id is not null and club_id is null)
  )
);

create unique index if not exists dm_attachment_restrictions_club_uniq
  on public.dm_attachment_restrictions(club_id) where scope = 'club';
create unique index if not exists dm_attachment_restrictions_user_uniq
  on public.dm_attachment_restrictions(user_id) where scope = 'user';

alter table public.dm_attachment_restrictions enable row level security;

create policy "anyone authenticated can read dm restrictions"
  on public.dm_attachment_restrictions for select
  to authenticated using (true);

create policy "app admins can insert dm restrictions"
  on public.dm_attachment_restrictions for insert
  to authenticated with check (public.has_role(auth.uid(), 'app_admin'::app_role));

create policy "app admins can delete dm restrictions"
  on public.dm_attachment_restrictions for delete
  to authenticated using (public.has_role(auth.uid(), 'app_admin'::app_role));

create or replace function public.dm_attachments_disabled(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_attachment_restrictions
    where scope = 'user' and user_id = _user_id
  ) or exists (
    select 1 from public.dm_attachment_restrictions r
    join public.user_roles ur on ur.club_id = r.club_id
    where r.scope = 'club' and ur.user_id = _user_id
  );
$$;
