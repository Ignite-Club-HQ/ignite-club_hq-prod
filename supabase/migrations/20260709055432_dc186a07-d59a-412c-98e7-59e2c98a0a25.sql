DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'write_audit_log'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "App admins can view write audit log" ON public.write_audit_log';
    EXECUTE 'CREATE POLICY "App admins can view write audit log" ON public.write_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''app_admin''))';
  END IF;
END $$;