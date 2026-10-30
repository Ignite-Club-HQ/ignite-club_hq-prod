DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='message_reads' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.message_reads', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users can view their own message reads"
ON public.message_reads FOR SELECT TO authenticated
USING (user_id = (select auth.uid()));

CREATE POLICY "Users can view others reads in shared threads"
ON public.message_reads FOR SELECT TO authenticated
USING (
  user_id <> (select auth.uid())
  AND public.can_view_message_read(
    (select auth.uid()),
    team_message_id,
    club_message_id,
    broadcast_message_id,
    group_message_id,
    direct_message_id,
    club_admin_message_id
  )
);
