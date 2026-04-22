CREATE POLICY "App admins can view all active games"
  ON public.active_games
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));