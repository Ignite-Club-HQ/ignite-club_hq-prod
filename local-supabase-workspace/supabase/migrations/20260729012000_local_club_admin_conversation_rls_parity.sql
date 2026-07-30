-- LOCAL TEST-ONLY RLS PARITY. NOT A DEPLOYMENT MIGRATION.
-- Production enables RLS on club_admin_conversations and limits rows to the
-- member, administrators of that exact club, or app administrators. The
-- isolated messaging baseline originally modelled message RLS but omitted
-- this conversation-table policy.

alter table public.club_admin_conversations enable row level security;

create policy club_admin_conversation_read
on public.club_admin_conversations
for select
to authenticated
using (
  member_id = auth.uid()
  or public.has_role(auth.uid(), 'club_admin', club_id, null)
  or public.has_role(auth.uid(), 'app_admin', null, null)
);

grant select on public.club_admin_conversations to authenticated;
