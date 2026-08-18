-- LOCAL SECURITY-TEST SCHEMA ONLY. NOT A DEPLOYMENT MIGRATION.
-- Synthetic messaging model used solely by tests against the isolated Docker stack.

create table public.chat_groups (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null, allow_forwarding boolean not null default true
);
create table public.chat_group_members (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, user_id)
);
create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(), user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id), check (user_a <> user_b)
);
create table public.club_admin_conversations (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade
);

create table public.team_messages (id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade, author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.team_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());
create table public.club_messages (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade, author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.club_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());
create table public.group_messages (id uuid primary key default gen_random_uuid(), group_id uuid not null references public.chat_groups(id) on delete cascade, author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.group_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());
create table public.direct_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.direct_conversations(id) on delete cascade, author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.direct_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());
create table public.broadcast_messages (id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.broadcast_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());
create table public.club_admin_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.club_admin_conversations(id) on delete cascade, author_id uuid not null references public.profiles(id), text text not null default '', image_url text, reply_to_id uuid references public.club_admin_messages(id), deleted_at timestamptz, created_at timestamptz not null default now());

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), reaction_type text not null,
  team_message_id uuid references public.team_messages(id) on delete cascade, club_message_id uuid references public.club_messages(id) on delete cascade,
  group_message_id uuid references public.group_messages(id) on delete cascade, direct_message_id uuid references public.direct_messages(id) on delete cascade,
  broadcast_message_id uuid references public.broadcast_messages(id) on delete cascade, club_admin_message_id uuid references public.club_admin_messages(id) on delete cascade,
  check (num_nonnulls(team_message_id, club_message_id, group_message_id, direct_message_id, broadcast_message_id, club_admin_message_id) = 1),
  unique nulls not distinct (user_id, team_message_id, club_message_id, group_message_id, direct_message_id, broadcast_message_id, club_admin_message_id)
);
create table public.message_pins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), message_kind text not null,
  message_id uuid not null, scope_id uuid, created_at timestamptz not null default now(), unique(user_id, message_kind, message_id)
);
create table public.message_reads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), message_kind text not null,
  message_id uuid not null, read_at timestamptz not null default now(), unique(user_id, message_kind, message_id)
);

create function public.can_access_message(_kind text, _message_id uuid, _user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select case _kind
    when 'team' then exists(select 1 from team_messages m where m.id=_message_id and is_team_member(_user,m.team_id))
    when 'club' then exists(select 1 from club_messages m where m.id=_message_id and is_club_member(_user,m.club_id))
    when 'group' then exists(select 1 from group_messages m join chat_group_members gm on gm.group_id=m.group_id where m.id=_message_id and gm.user_id=_user)
    when 'dm' then exists(select 1 from direct_messages m join direct_conversations c on c.id=m.conversation_id where m.id=_message_id and _user in (c.user_a,c.user_b))
    when 'broadcast' then exists(select 1 from broadcast_messages m where m.id=_message_id)
    when 'club_admin' then exists(select 1 from club_admin_messages m join club_admin_conversations c on c.id=m.conversation_id where m.id=_message_id and (c.member_id=_user or has_role(_user,'club_admin',c.club_id,null)))
    else false end;
$$;

alter table public.team_messages enable row level security; alter table public.club_messages enable row level security;
alter table public.group_messages enable row level security; alter table public.direct_messages enable row level security;
alter table public.broadcast_messages enable row level security; alter table public.club_admin_messages enable row level security;
alter table public.message_reactions enable row level security; alter table public.message_pins enable row level security; alter table public.message_reads enable row level security;

create policy team_read on public.team_messages for select to authenticated using (is_team_member(auth.uid(),team_id) or exists(select 1 from teams t where t.id=team_messages.team_id and has_role(auth.uid(),'club_admin',t.club_id,null)) or has_role(auth.uid(),'app_admin',null,null));
create policy team_send on public.team_messages for insert to authenticated with check (author_id=auth.uid() and (is_team_member(auth.uid(),team_id) or exists(select 1 from teams t where t.id=team_messages.team_id and has_role(auth.uid(),'club_admin',t.club_id,null)) or has_role(auth.uid(),'app_admin',null,null)));
create policy team_change on public.team_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy team_delete on public.team_messages for delete to authenticated using (author_id=auth.uid() or has_role(auth.uid(),'team_admin',null,team_id) or has_role(auth.uid(),'coach',null,team_id) or exists(select 1 from teams t where t.id=team_messages.team_id and has_role(auth.uid(),'club_admin',t.club_id,null)) or has_role(auth.uid(),'app_admin',null,null));
create policy club_read on public.club_messages for select to authenticated using (is_club_member(auth.uid(),club_id));
create policy club_send on public.club_messages for insert to authenticated with check (author_id=auth.uid() and is_club_member(auth.uid(),club_id));
create policy club_change on public.club_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy club_delete on public.club_messages for delete to authenticated using (author_id=auth.uid() or has_role(auth.uid(),'club_admin',club_id,null));
create policy group_read on public.group_messages for select to authenticated using (exists(select 1 from chat_group_members gm where gm.group_id=group_messages.group_id and gm.user_id=auth.uid()));
create policy group_send on public.group_messages for insert to authenticated with check (author_id=auth.uid() and exists(select 1 from chat_group_members gm where gm.group_id=group_messages.group_id and gm.user_id=auth.uid()));
create policy group_change on public.group_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy group_delete on public.group_messages for delete to authenticated using (author_id=auth.uid());
create policy dm_read on public.direct_messages for select to authenticated using (exists(select 1 from direct_conversations c where c.id=conversation_id and auth.uid() in(c.user_a,c.user_b)));
create policy dm_send on public.direct_messages for insert to authenticated with check (author_id=auth.uid() and exists(select 1 from direct_conversations c where c.id=conversation_id and auth.uid() in(c.user_a,c.user_b)));
create policy dm_change on public.direct_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy dm_delete on public.direct_messages for delete to authenticated using (author_id=auth.uid());
create policy broadcast_read on public.broadcast_messages for select to authenticated using (true);
create policy broadcast_write on public.broadcast_messages for all to authenticated using (has_role(auth.uid(),'app_admin',null,null)) with check (author_id=auth.uid() and has_role(auth.uid(),'app_admin',null,null));
create policy admin_read on public.club_admin_messages for select to authenticated using (exists(select 1 from club_admin_conversations c where c.id=conversation_id and (c.member_id=auth.uid() or has_role(auth.uid(),'club_admin',c.club_id,null))));
create policy admin_send on public.club_admin_messages for insert to authenticated with check (author_id=auth.uid() and exists(select 1 from club_admin_conversations c where c.id=conversation_id and (c.member_id=auth.uid() or has_role(auth.uid(),'club_admin',c.club_id,null))));
create policy admin_change on public.club_admin_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy admin_delete on public.club_admin_messages for delete to authenticated using (author_id=auth.uid());
create policy reaction_read on public.message_reactions for select to authenticated using (can_access_message(case when team_message_id is not null then 'team' when club_message_id is not null then 'club' when group_message_id is not null then 'group' when direct_message_id is not null then 'dm' when broadcast_message_id is not null then 'broadcast' else 'club_admin' end, coalesce(team_message_id,club_message_id,group_message_id,direct_message_id,broadcast_message_id,club_admin_message_id)));
create policy reaction_write on public.message_reactions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and can_access_message(case when team_message_id is not null then 'team' when club_message_id is not null then 'club' when group_message_id is not null then 'group' when direct_message_id is not null then 'dm' when broadcast_message_id is not null then 'broadcast' else 'club_admin' end, coalesce(team_message_id,club_message_id,group_message_id,direct_message_id,broadcast_message_id,club_admin_message_id)));
create policy pins_own on public.message_pins for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and can_access_message(message_kind,message_id));
create policy reads_own on public.message_reads for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and can_access_message(message_kind,message_id));

grant select,insert,update,delete on public.team_messages,public.club_messages,public.group_messages,public.direct_messages,public.broadcast_messages,public.club_admin_messages,public.message_reactions,public.message_pins,public.message_reads to authenticated;
