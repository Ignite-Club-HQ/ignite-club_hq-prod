-- Remove duplicate rsvp_updated rows, keep the earliest per (user, event, message)
DELETE FROM public.notifications n
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, related_id, md5(message)
           ORDER BY created_at ASC
         ) AS rn
  FROM public.notifications
  WHERE type IN ('rsvp_updated', 'rsvp_update')
) dups
WHERE n.id = dups.id AND dups.rn > 1;

-- Now safe to add the unique index
CREATE UNIQUE INDEX IF NOT EXISTS notifications_rsvp_dedupe_idx
ON public.notifications (user_id, related_id, md5(message))
WHERE type IN ('rsvp_updated', 'rsvp_update');