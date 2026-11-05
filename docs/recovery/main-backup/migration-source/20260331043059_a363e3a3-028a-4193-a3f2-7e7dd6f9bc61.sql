
-- Add club_admin_message_id to message_reads
alter table public.message_reads
  add column club_admin_message_id uuid references public.club_admin_messages(id) on delete cascade;

create index idx_message_reads_club_admin_msg on message_reads(club_admin_message_id) where club_admin_message_id is not null;
