WITH ranked_duplicates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, type, related_id, message
      ORDER BY is_read ASC, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.notifications
  WHERE type = 'duty_completed'
    AND related_id IS NOT NULL
)
DELETE FROM public.notifications n
USING ranked_duplicates r
WHERE n.id = r.id
  AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_duty_completed
ON public.notifications (user_id, type, related_id, message)
WHERE type = 'duty_completed'
  AND related_id IS NOT NULL;