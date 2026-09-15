-- LOCAL SECURITY-TEST SCHEMA ONLY. NOT A DEPLOYMENT MIGRATION.
-- Realtime publication parity for synthetic messaging lifecycle tests.

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach table_name in array array[
    'team_messages',
    'club_messages',
    'group_messages',
    'direct_messages',
    'broadcast_messages',
    'club_admin_messages',
    'message_reactions',
    'message_reads'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

-- Filtered DELETE subscriptions require the old scope columns, matching the
-- deployed chat-table migration history.
alter table public.team_messages replica identity full;
alter table public.club_messages replica identity full;
alter table public.group_messages replica identity full;
alter table public.direct_messages replica identity full;
alter table public.broadcast_messages replica identity full;
alter table public.club_admin_messages replica identity full;
alter table public.message_reactions replica identity full;
alter table public.message_reads replica identity full;
