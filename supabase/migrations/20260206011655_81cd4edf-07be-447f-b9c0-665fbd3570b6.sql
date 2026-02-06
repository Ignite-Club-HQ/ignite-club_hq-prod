-- First, remove all but the most recent reaction per user per message (keeping only one reaction per user per message)

-- For group messages - keep only the most recent reaction per user
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.group_message_id IS NOT NULL
  AND a.group_message_id = b.group_message_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- For team messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.team_message_id IS NOT NULL
  AND a.team_message_id = b.team_message_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- For club messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.club_message_id IS NOT NULL
  AND a.club_message_id = b.club_message_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- For direct messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.direct_message_id IS NOT NULL
  AND a.direct_message_id = b.direct_message_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- For broadcast messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.broadcast_message_id IS NOT NULL
  AND a.broadcast_message_id = b.broadcast_message_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- Drop the old indexes that allowed multiple reaction types per user
DROP INDEX IF EXISTS unique_group_message_reaction;
DROP INDEX IF EXISTS unique_team_message_reaction;
DROP INDEX IF EXISTS unique_club_message_reaction;
DROP INDEX IF EXISTS unique_direct_message_reaction;
DROP INDEX IF EXISTS unique_broadcast_message_reaction;

-- Create new unique indexes that only allow ONE reaction per user per message (regardless of type)
CREATE UNIQUE INDEX unique_group_message_user_reaction 
ON public.message_reactions (group_message_id, user_id) 
WHERE group_message_id IS NOT NULL;

CREATE UNIQUE INDEX unique_team_message_user_reaction 
ON public.message_reactions (team_message_id, user_id) 
WHERE team_message_id IS NOT NULL;

CREATE UNIQUE INDEX unique_club_message_user_reaction 
ON public.message_reactions (club_message_id, user_id) 
WHERE club_message_id IS NOT NULL;

CREATE UNIQUE INDEX unique_direct_message_user_reaction 
ON public.message_reactions (direct_message_id, user_id) 
WHERE direct_message_id IS NOT NULL;

CREATE UNIQUE INDEX unique_broadcast_message_user_reaction 
ON public.message_reactions (broadcast_message_id, user_id) 
WHERE broadcast_message_id IS NOT NULL;