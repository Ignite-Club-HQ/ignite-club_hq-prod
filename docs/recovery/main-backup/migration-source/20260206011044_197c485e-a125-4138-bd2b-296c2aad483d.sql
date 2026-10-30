-- First, remove duplicate reactions keeping only the most recent one
-- For group messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.group_message_id IS NOT NULL
  AND a.group_message_id = b.group_message_id
  AND a.user_id = b.user_id
  AND a.reaction_type = b.reaction_type
  AND a.id < b.id;

-- For team messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.team_message_id IS NOT NULL
  AND a.team_message_id = b.team_message_id
  AND a.user_id = b.user_id
  AND a.reaction_type = b.reaction_type
  AND a.id < b.id;

-- For club messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.club_message_id IS NOT NULL
  AND a.club_message_id = b.club_message_id
  AND a.user_id = b.user_id
  AND a.reaction_type = b.reaction_type
  AND a.id < b.id;

-- For direct messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.direct_message_id IS NOT NULL
  AND a.direct_message_id = b.direct_message_id
  AND a.user_id = b.user_id
  AND a.reaction_type = b.reaction_type
  AND a.id < b.id;

-- For broadcast messages
DELETE FROM public.message_reactions a
USING public.message_reactions b
WHERE a.broadcast_message_id IS NOT NULL
  AND a.broadcast_message_id = b.broadcast_message_id
  AND a.user_id = b.user_id
  AND a.reaction_type = b.reaction_type
  AND a.id < b.id;

-- Now add unique constraints to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS unique_group_message_reaction 
ON public.message_reactions (group_message_id, user_id, reaction_type) 
WHERE group_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_team_message_reaction 
ON public.message_reactions (team_message_id, user_id, reaction_type) 
WHERE team_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_club_message_reaction 
ON public.message_reactions (club_message_id, user_id, reaction_type) 
WHERE club_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_direct_message_reaction 
ON public.message_reactions (direct_message_id, user_id, reaction_type) 
WHERE direct_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_broadcast_message_reaction 
ON public.message_reactions (broadcast_message_id, user_id, reaction_type) 
WHERE broadcast_message_id IS NOT NULL;