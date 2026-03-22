-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "Admins and coaches can insert points history" ON public.points_history;

-- Create a new INSERT policy that allows:
-- 1. Users to insert their own points history (for client-side awards like engagement, early RSVP)
-- 2. Admins/coaches to insert for others (manual awards)
CREATE POLICY "Users and admins can insert points history"
ON public.points_history
FOR INSERT
TO authenticated
WITH CHECK (
  -- Users can insert their own history (no created_by needed)
  (user_id = auth.uid())
  OR
  -- Users can insert for their own children
  (child_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM children c WHERE c.id = points_history.child_id AND c.parent_id = auth.uid()
  ))
  OR
  -- Admins/coaches can insert for club members
  (created_by = auth.uid() AND (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin')
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.club_id = points_history.club_id AND ur.role IN ('club_admin', 'team_admin', 'coach'))
  ))
);