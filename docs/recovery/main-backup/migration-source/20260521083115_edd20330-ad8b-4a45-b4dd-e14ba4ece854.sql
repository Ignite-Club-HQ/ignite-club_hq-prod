CREATE OR REPLACE FUNCTION public.get_event_non_responders_audience(_event_id uuid, _audience text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ev AS (
    SELECT id, team_id, club_id FROM public.events WHERE id = _event_id
  ),
  team_members AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur, ev
    WHERE ur.team_id = ev.team_id
      AND ur.user_id IS NOT NULL
  ),
  responded_self AS (
    SELECT DISTINCT user_id FROM public.rsvps
    WHERE event_id = _event_id AND child_id IS NULL AND user_id IS NOT NULL
  ),
  rostered_children AS (
    -- Children rostered on this event's team
    SELECT cta.child_id
    FROM public.child_team_assignments cta, ev
    WHERE cta.team_id = ev.team_id
  ),
  household_links AS (
    -- (parent_user_id, child_id) pairs limited to rostered kids on this team
    SELECT c.parent_id AS user_id, c.id AS child_id
    FROM public.children c
    JOIN rostered_children rc ON rc.child_id = c.id
    WHERE c.parent_id IS NOT NULL
    UNION
    SELECT cg.guardian_id AS user_id, cg.child_id
    FROM public.child_guardians cg
    JOIN rostered_children rc ON rc.child_id = cg.child_id
    WHERE cg.guardian_id IS NOT NULL
  ),
  responded_child_ids AS (
    SELECT DISTINCT child_id FROM public.rsvps
    WHERE event_id = _event_id AND child_id IS NOT NULL
  ),
  -- "All rostered kids responded" per parent (used for players_only / mixed)
  parents_all_kids_responded AS (
    SELECT user_id
    FROM household_links
    GROUP BY user_id
    HAVING bool_and(child_id IN (SELECT child_id FROM responded_child_ids))
  ),
  -- "Any rostered kid responded" per parent (used for legacy mixed satisfaction)
  parents_any_kid_responded AS (
    SELECT DISTINCT user_id
    FROM household_links
    WHERE child_id IN (SELECT child_id FROM responded_child_ids)
  ),
  parents_with_rostered_kids AS (
    SELECT DISTINCT user_id FROM household_links
  )
  SELECT tm.user_id
  FROM team_members tm
  WHERE CASE
    WHEN _audience = 'parents_only' THEN
      tm.user_id NOT IN (SELECT user_id FROM responded_self)
    WHEN _audience = 'players_only' THEN
      tm.user_id IN (SELECT user_id FROM parents_with_rostered_kids)
      AND tm.user_id NOT IN (SELECT user_id FROM parents_all_kids_responded)
    ELSE
      -- players_and_parents (default): satisfied if self responded OR any rostered kid responded
      tm.user_id NOT IN (SELECT user_id FROM responded_self)
      AND tm.user_id NOT IN (SELECT user_id FROM parents_any_kid_responded)
  END;
$$;