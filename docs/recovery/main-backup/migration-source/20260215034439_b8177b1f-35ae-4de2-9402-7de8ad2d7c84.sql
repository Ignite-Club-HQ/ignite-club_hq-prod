CREATE POLICY "App admins can update any profile"
ON public.profiles
FOR UPDATE
USING (has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid));