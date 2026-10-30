-- Drop the older duplicate function with (user_id, team_id, name, year) parameter order
DROP FUNCTION IF EXISTS public.create_child_for_parent_on_team(uuid, uuid, text, integer);