-- Add INSERT policy for notifications table
-- Allow admins to insert notifications for members in their clubs/teams

CREATE POLICY "Admins can insert notifications for their members"
ON public.notifications
FOR INSERT
WITH CHECK (
  -- App admins can notify anyone
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
  )
  OR
  -- Club admins can notify their club members
  EXISTS (
    SELECT 1 FROM public.user_roles admin_role
    JOIN public.user_roles member_role ON admin_role.club_id = member_role.club_id
    WHERE admin_role.user_id = auth.uid()
      AND admin_role.role = 'club_admin'
      AND member_role.user_id = notifications.user_id
  )
  OR
  -- Team admins/coaches can notify their team members
  EXISTS (
    SELECT 1 FROM public.user_roles admin_role
    JOIN public.user_roles member_role ON admin_role.team_id = member_role.team_id
    WHERE admin_role.user_id = auth.uid()
      AND admin_role.role IN ('team_admin', 'coach')
      AND member_role.user_id = notifications.user_id
  )
);