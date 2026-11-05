-- 1. Dedupe existing rows (keep the one most likely to represent a real send:
--    prefer status='sent', then earliest created_at).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY notification_id
           ORDER BY (status = 'sent') DESC, created_at ASC, id ASC
         ) AS rn
  FROM public.push_notification_logs
  WHERE notification_id IS NOT NULL
    AND endpoint <> 'retry-placeholder'
)
DELETE FROM public.push_notification_logs l
USING ranked r
WHERE l.id = r.id AND r.rn > 1;

-- 2. Partial unique index — guarantees only one non-placeholder log per
--    notification_id, closing the race where two concurrent send-push
--    invocations both pass the maybeSingle() dedup check.
CREATE UNIQUE INDEX IF NOT EXISTS push_notification_logs_notification_id_unique
  ON public.push_notification_logs (notification_id)
  WHERE notification_id IS NOT NULL
    AND endpoint <> 'retry-placeholder';