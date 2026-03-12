-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view RSVPs for events they can see" ON public.rsvps;

-- Recreate with proper membership scoping
CREATE POLICY "Users can view RSVPs for events they can see" ON public.rsvps
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rsvps.event_id
    AND (
      -- User is in the same club
      EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
        AND ur.club_id = e.club_id
      )
      -- Or user is in the same team
      OR (e.team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
        AND ur.team_id = e.team_id
      ))
    )
  )
);