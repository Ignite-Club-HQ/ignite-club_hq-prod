-- Add UPDATE policy for photos table (needed for soft delete)
CREATE POLICY "Uploaders and admins can update photos" 
ON public.photos 
FOR UPDATE 
USING (
  uploader_id = auth.uid() 
  OR has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid) 
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id) 
  OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);