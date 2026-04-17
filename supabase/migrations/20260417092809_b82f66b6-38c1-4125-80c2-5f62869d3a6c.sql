-- Add direct_messages to realtime publication so DM inserts/updates broadcast in real-time
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- Set REPLICA IDENTITY FULL on chat tables so realtime DELETE/UPDATE payloads include the full old row
ALTER TABLE public.team_messages REPLICA IDENTITY FULL;
ALTER TABLE public.club_messages REPLICA IDENTITY FULL;
ALTER TABLE public.group_messages REPLICA IDENTITY FULL;
ALTER TABLE public.broadcast_messages REPLICA IDENTITY FULL;
ALTER TABLE public.club_admin_messages REPLICA IDENTITY FULL;
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.poll_votes REPLICA IDENTITY FULL;