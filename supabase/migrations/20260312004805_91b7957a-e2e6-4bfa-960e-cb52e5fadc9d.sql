-- business_shortlist: club admins and app admins can manage their shortlist
CREATE POLICY "Club admins can view shortlist" ON public.business_shortlist
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.club_id = business_shortlist.club_id
    AND ur.role IN ('club_admin', 'app_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'app_admin'
  )
);

CREATE POLICY "Club admins can insert shortlist" ON public.business_shortlist
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.club_id = business_shortlist.club_id
    AND ur.role IN ('club_admin', 'app_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'app_admin'
  )
);

CREATE POLICY "Club admins can delete shortlist" ON public.business_shortlist
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.club_id = business_shortlist.club_id
    AND ur.role IN ('club_admin', 'app_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'app_admin'
  )
);

-- chat_notification_log: only service role should insert (from triggers), restrict all client access
CREATE POLICY "No direct client access to chat notification log" ON public.chat_notification_log
FOR SELECT TO authenticated
USING (false);

CREATE POLICY "No direct client insert to chat notification log" ON public.chat_notification_log
FOR INSERT TO authenticated
WITH CHECK (false);