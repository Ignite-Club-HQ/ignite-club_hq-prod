-- Step 1: Replace inline EXISTS subquery on app_ad_settings with cached has_role() call.
-- Semantics unchanged: still restricts management to app_admin users.
DROP POLICY IF EXISTS "App admins can manage ad settings" ON public.app_ad_settings;
CREATE POLICY "App admins can manage ad settings"
ON public.app_ad_settings
FOR ALL
USING (public.has_role((SELECT auth.uid()), 'app_admin'::app_role))
WITH CHECK (public.has_role((SELECT auth.uid()), 'app_admin'::app_role));

-- Also wrap auth.uid() so the SELECT policy plans as an initplan (one eval per query).
DROP POLICY IF EXISTS "Authenticated users can view ad settings" ON public.app_ad_settings;
CREATE POLICY "Authenticated users can view ad settings"
ON public.app_ad_settings
FOR SELECT
USING ((SELECT auth.uid()) IS NOT NULL);

-- Step 2: notifications policies — wrap auth.uid() in (SELECT ...) so Postgres caches it.
-- Semantics IDENTICAL: each policy still scopes by user_id = auth.uid().
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
ON public.notifications
FOR SELECT
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
ON public.notifications
FOR UPDATE
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
ON public.notifications
FOR DELETE
USING (user_id = (SELECT auth.uid()));