
-- Club admin conversations: one per (club_id, member_user_id)
create table public.club_admin_conversations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(club_id, member_user_id)
);

-- Club admin messages
create table public.club_admin_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.club_admin_conversations(id) on delete cascade,
  author_id uuid not null,
  text text not null default '',
  image_url text,
  reply_to_id uuid references public.club_admin_messages(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Add club_admin_message_id to message_reactions
alter table public.message_reactions
  add column club_admin_message_id uuid references public.club_admin_messages(id) on delete cascade;

-- Enable RLS
alter table public.club_admin_conversations enable row level security;
alter table public.club_admin_messages enable row level security;

-- Helper function: check if user is participant of a club admin conversation
create or replace function is_club_admin_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    -- User is the member
    select 1 from club_admin_conversations
    where id = p_conversation_id and member_user_id = auth.uid()
    union all
    -- User is a club_admin for the club
    select 1 from club_admin_conversations cac
    join user_roles ur on ur.club_id = cac.club_id and ur.user_id = auth.uid()
    where cac.id = p_conversation_id and ur.role = 'club_admin'
    union all
    -- User is an app_admin
    select 1 from user_roles
    where user_id = auth.uid() and role = 'app_admin'
  )
$$;

-- RLS policies for club_admin_conversations
create policy "Users can view their own club admin conversations"
  on public.club_admin_conversations for select to authenticated
  using (is_club_admin_conversation_participant(id));

create policy "Authenticated users can create club admin conversations"
  on public.club_admin_conversations for insert to authenticated
  with check (member_user_id = auth.uid());

create policy "Participants can update club admin conversations"
  on public.club_admin_conversations for update to authenticated
  using (is_club_admin_conversation_participant(id));

-- RLS policies for club_admin_messages
create policy "Participants can view club admin messages"
  on public.club_admin_messages for select to authenticated
  using (is_club_admin_conversation_participant(conversation_id));

create policy "Participants can send club admin messages"
  on public.club_admin_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and is_club_admin_conversation_participant(conversation_id)
  );

create policy "Authors can update their own club admin messages"
  on public.club_admin_messages for update to authenticated
  using (author_id = auth.uid());

-- RPC to get or create a club admin conversation
create or replace function get_or_create_club_admin_conversation(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  -- Check if conversation already exists
  select id into v_conversation_id
  from club_admin_conversations
  where club_id = p_club_id and member_user_id = auth.uid();

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  -- Create new conversation
  insert into club_admin_conversations (club_id, member_user_id)
  values (p_club_id, auth.uid())
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- Enable realtime for club_admin_messages
alter publication supabase_realtime add table club_admin_messages;

-- Create indexes for performance
create index idx_club_admin_conversations_club on club_admin_conversations(club_id);
create index idx_club_admin_conversations_member on club_admin_conversations(member_user_id);
create index idx_club_admin_messages_conversation on club_admin_messages(conversation_id, created_at desc);
create index idx_club_admin_messages_author on club_admin_messages(author_id);
create index idx_message_reactions_club_admin_msg on message_reactions(club_admin_message_id) where club_admin_message_id is not null;
