-- Allow club creators to assign themselves as club_admin
CREATE POLICY "Club creators can assign themselves as admin"
ON public.user_roles
FOR INSERT
WITH CHECK (
  user_id = auth.uid() 
  AND role = 'club_admin' 
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.clubs 
    WHERE id = club_id 
    AND created_by = auth.uid()
  )
);