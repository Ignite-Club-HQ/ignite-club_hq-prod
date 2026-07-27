-- LOCAL SECURITY-TEST PREREQUISITES ONLY. NOT A DEPLOYMENT MIGRATION.
-- Minimal synthetic schema needed to exercise the production Vault mutation
-- safety migration in the isolated Docker Supabase stack.

alter table public.club_subscriptions
  add column if not exists storage_purchased_gb integer not null default 0;

alter table public.photos
  alter column club_id drop not null,
  add column if not exists mini_league_id uuid,
  add column if not exists image_url text,
  add column if not exists file_size bigint,
  add column if not exists show_in_feed boolean not null default true;

create table public.mini_leagues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.photos
  add constraint photos_mini_league_id_fkey
  foreign key (mini_league_id) references public.mini_leagues(id) on delete cascade;

create table public.mini_league_admins (
  id uuid primary key default gen_random_uuid(),
  mini_league_id uuid not null references public.mini_leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unique (mini_league_id, user_id)
);

create table public.vault_files (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  mini_league_id uuid references public.mini_leagues(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  file_url text not null,
  file_size bigint,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.file_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  club_id uuid,
  team_id uuid,
  file_url text,
  file_size bigint,
  deleted_by uuid,
  deletion_type text,
  original_created_at timestamptz,
  original_uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table public.photo_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null,
  club_id uuid,
  team_id uuid,
  file_url text,
  image_url text,
  file_size bigint,
  deleted_by uuid,
  deletion_type text,
  original_created_at timestamptz,
  original_uploader_id uuid,
  created_at timestamptz not null default now()
);

grant all on public.mini_leagues, public.mini_league_admins,
  public.vault_files, public.file_deletion_logs, public.photo_deletion_logs
  to service_role;
grant select, insert, update, delete on public.vault_files to authenticated;

alter table public.mini_leagues enable row level security;
alter table public.mini_league_admins enable row level security;
alter table public.vault_files enable row level security;
alter table public.file_deletion_logs enable row level security;
alter table public.photo_deletion_logs enable row level security;

-- Deliberately no authenticated policies for these local prerequisite tables.
-- Vault mutations must pass through the privileged, authorization-enforcing
-- functions copied from the production migration in the next local migration.
