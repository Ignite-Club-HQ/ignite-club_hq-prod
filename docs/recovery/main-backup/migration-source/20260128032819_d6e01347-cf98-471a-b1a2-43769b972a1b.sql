-- Backfill chats for existing mini leagues that don't have one
INSERT INTO public.chat_groups (name, mini_league_id, club_id, created_by, allowed_roles)
SELECT 
  ml.name || ' Chat',
  ml.id,
  ml.club_id,
  ml.created_by,
  ARRAY['league_admin', 'coach', 'club_admin', 'parent', 'app_admin']::app_role[]
FROM public.mini_leagues ml
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_groups cg WHERE cg.mini_league_id = ml.id
);