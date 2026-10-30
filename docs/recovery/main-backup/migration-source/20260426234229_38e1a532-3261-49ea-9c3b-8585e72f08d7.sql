-- Allow legitimate user-initiated notifications (chat replies, photo comments,
-- RSVP confirmations, join requests, etc.) to be inserted into public.notifications.
-- The previous INSERT policy only allowed admins/coaches, which caused
-- "new row violates row-level security policy for table notifications" errors
-- whenever a regular member triggered a notification for another user.

-- Self-notifications (e.g. local reminders, system flows acting as the user)
CREATE POLICY "Users can insert their own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Notifications targeting another user the actor shares a club or team with
CREATE POLICY "Users can notify members in shared org scope"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id <> auth.uid()
  AND (
    EXISTS (
      SELECT 1
      FROM public.user_roles me
      JOIN public.user_roles them
        ON me.club_id = them.club_id
       AND me.club_id IS NOT NULL
      WHERE me.user_id = auth.uid()
        AND them.user_id = notifications.user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles me
      JOIN public.user_roles them
        ON me.team_id = them.team_id
       AND me.team_id IS NOT NULL
      WHERE me.user_id = auth.uid()
        AND them.user_id = notifications.user_id
    )
  )
);