
-- Tighten INSERT policies to only allow admins
DROP POLICY "Authenticated can insert photo deletion logs" ON public.photo_deletion_logs;
CREATE POLICY "Admins can insert photo deletion logs"
  ON public.photo_deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('app_admin', 'club_admin')
    )
  );

DROP POLICY "Authenticated can insert file deletion logs" ON public.file_deletion_logs;
CREATE POLICY "Admins can insert file deletion logs"
  ON public.file_deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('app_admin', 'club_admin')
    )
  );
