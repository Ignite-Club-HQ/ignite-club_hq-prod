
-- Step 1: Delete duplicate RSVPs, keeping the earliest one for each (event_id, user_id, child_id) combination
DELETE FROM public.rsvps
WHERE id NOT IN (
  SELECT DISTINCT ON (event_id, user_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'))
    id
  FROM public.rsvps
  ORDER BY event_id, user_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'), created_at ASC
);

-- Step 2: Add unique constraint to prevent future duplicates
-- For user RSVPs (no child): unique on (event_id, user_id) where child_id is null
CREATE UNIQUE INDEX rsvps_unique_user_event 
  ON public.rsvps (event_id, user_id) 
  WHERE child_id IS NULL AND mini_league_player_id IS NULL;

-- For child RSVPs: unique on (event_id, child_id)
CREATE UNIQUE INDEX rsvps_unique_child_event 
  ON public.rsvps (event_id, child_id) 
  WHERE child_id IS NOT NULL;

-- For mini league player RSVPs: unique on (event_id, mini_league_player_id)
CREATE UNIQUE INDEX rsvps_unique_player_event 
  ON public.rsvps (event_id, mini_league_player_id) 
  WHERE mini_league_player_id IS NOT NULL;
