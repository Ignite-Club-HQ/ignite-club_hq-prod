-- Drop the existing restrictive delete policy
DROP POLICY IF EXISTS "Team admins can delete team messages" ON public.team_messages;

-- Create a new delete policy that allows: message author, team_admin, coach, club_admin, app_admin
CREATE POLICY "Team members can delete own or admin delete team messages"
ON public.team_messages
FOR DELETE
TO authenticated
USING (
  author_id = auth.uid()
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  OR EXISTS (
    SELECT 1 FROM teams t
    WHERE t.id = team_messages.team_id
    AND has_role(auth.uid(), 'club_admin'::app_role, t.club_id, NULL::uuid)
  )
);

-- Create update policy so authors can edit their own messages
CREATE POLICY "Authors can update own team messages"
ON public.team_messages
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());