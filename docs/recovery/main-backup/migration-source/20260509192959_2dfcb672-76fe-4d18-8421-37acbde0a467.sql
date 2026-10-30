CREATE OR REPLACE FUNCTION public.get_push_notification_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  ) THEN
    RAISE EXCEPTION 'Access denied: app_admin role required';
  END IF;

  WITH win AS (
    SELECT * FROM public.push_notification_logs
    WHERE created_at > now() - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'window_hours', 24,
    'generated_at', now(),
    'total_24h', (SELECT COUNT(*) FROM win),
    'sent_real', (
      SELECT COUNT(*) FROM win
      WHERE status = 'sent'
        AND endpoint NOT IN ('pending', 'retry-placeholder')
        AND endpoint NOT LIKE 'skipped%'
    ),
    'failed_24h', (SELECT COUNT(*) FROM win WHERE status = 'failed'),
    'expired_24h', (SELECT COUNT(*) FROM win WHERE status = 'expired'),
    'skipped_24h', (
      SELECT COUNT(*) FROM win
      WHERE status = 'skipped' OR endpoint LIKE 'skipped%'
    ),
    -- Pending placeholder rows older than 5 minutes are stuck
    -- (a real send finalises in well under a second).
    'stuck_placeholders', (
      SELECT COUNT(*) FROM public.push_notification_logs
      WHERE endpoint = 'pending'
        AND created_at < now() - interval '5 minutes'
    ),
    'pending_inflight', (
      SELECT COUNT(*) FROM public.push_notification_logs
      WHERE endpoint = 'pending'
        AND created_at >= now() - interval '5 minutes'
    ),
    'legacy_retry_placeholders', (
      SELECT COUNT(*) FROM public.push_notification_logs
      WHERE endpoint = 'retry-placeholder'
    ),
    -- Notifications that resulted in more than one real log row in the window.
    'notifications_with_retries', (
      SELECT COUNT(*) FROM (
        SELECT notification_id
        FROM public.push_notification_logs
        WHERE created_at > now() - interval '24 hours'
          AND notification_id IS NOT NULL
          AND endpoint <> 'retry-placeholder'
        GROUP BY notification_id
        HAVING COUNT(*) > 1
      ) s
    ),
    -- Notifications created >2min ago with skip_push=false and no log row at all.
    'missed_notifications', (
      SELECT COUNT(*) FROM public.notifications n
      WHERE n.created_at > now() - interval '24 hours'
        AND n.created_at < now() - interval '2 minutes'
        AND COALESCE(n.skip_push, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.push_notification_logs l
          WHERE l.notification_id = n.id
        )
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_push_notification_health() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_push_notification_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_push_notification_health() TO authenticated;