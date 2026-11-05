-- 1. Per-team toggle (default ON)
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS auto_rsvp_dm_enabled boolean NOT NULL DEFAULT true;

-- 2. Dedupe log
CREATE TABLE IF NOT EXISTS public.event_auto_dm_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('t72','t24','t3')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  dm_message_id uuid,
  UNIQUE (event_id, user_id, cadence)
);

CREATE INDEX IF NOT EXISTS idx_event_auto_dm_log_event ON public.event_auto_dm_log(event_id);
CREATE INDEX IF NOT EXISTS idx_event_auto_dm_log_user ON public.event_auto_dm_log(user_id);

ALTER TABLE public.event_auto_dm_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view auto-DM log for their events"
ON public.event_auto_dm_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.user_roles ur ON ur.user_id = auth.uid()
    WHERE e.id = event_auto_dm_log.event_id
      AND (
        ur.role = 'app_admin'
        OR (ur.team_id = e.team_id AND ur.role IN ('team_admin','coach'))
        OR (ur.club_id = e.club_id AND ur.role IN ('club_admin','league_admin','committee_member'))
      )
  )
);

-- 3. Helper: non-responders for an event
CREATE OR REPLACE FUNCTION public.get_event_non_responders(_event_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
  responded_child_ids AS (
    SELECT DISTINCT child_id FROM public.rsvps
    WHERE event_id = _event_id AND child_id IS NOT NULL
  ),
  parents_with_responded_kids AS (
    SELECT DISTINCT c.parent_id AS user_id
    FROM public.children c
    JOIN responded_child_ids rci ON rci.child_id = c.id
    WHERE c.parent_id IS NOT NULL
    UNION
    SELECT DISTINCT cg.guardian_id AS user_id
    FROM public.child_guardians cg
    JOIN responded_child_ids rci ON rci.child_id = cg.child_id
    WHERE cg.guardian_id IS NOT NULL
  )
  SELECT tm.user_id
  FROM team_members tm
  WHERE tm.user_id NOT IN (SELECT user_id FROM responded_self)
    AND tm.user_id NOT IN (SELECT user_id FROM parents_with_responded_kids);
$$;