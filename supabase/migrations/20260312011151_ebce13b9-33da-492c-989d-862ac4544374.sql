-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Service role can insert push logs" ON public.push_notification_logs;

-- Recreate for service_role only
CREATE POLICY "Service role can insert push logs" ON public.push_notification_logs
FOR INSERT TO service_role
WITH CHECK (true);