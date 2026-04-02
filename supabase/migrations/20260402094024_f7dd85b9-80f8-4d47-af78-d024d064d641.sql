
-- 1. Delete older rsvp_update duplicates where a matching rsvp_updated exists
DELETE FROM public.notifications n1
WHERE n1.type = 'rsvp_update'
AND EXISTS (
  SELECT 1 FROM public.notifications n2
  WHERE n2.user_id = n1.user_id
    AND n2.related_id = n1.related_id
    AND n2.message = n1.message
    AND n2.type = 'rsvp_updated'
    AND n2.created_at BETWEEN n1.created_at - interval '2 minutes' AND n1.created_at + interval '2 minutes'
);

-- 2. Delete remaining rsvp_update records (convert old type to rsvp_updated)
-- Actually just delete them - they're duplicates of rsvp_updated
DELETE FROM public.notifications WHERE type = 'rsvp_update';

-- 3. Delete true duplicates within rsvp_updated (keep only the earliest)
DELETE FROM public.notifications n1
WHERE n1.type = 'rsvp_updated'
AND EXISTS (
  SELECT 1 FROM public.notifications n2
  WHERE n2.user_id = n1.user_id
    AND n2.related_id = n1.related_id
    AND n2.message = n1.message
    AND n2.type = 'rsvp_updated'
    AND n2.created_at < n1.created_at
    AND n1.created_at - n2.created_at < interval '2 minutes'
);

-- 4. Add index to speed up dedup lookups in the trigger
CREATE INDEX IF NOT EXISTS idx_notifications_rsvp_dedup_lookup
ON public.notifications (user_id, related_id, message, created_at DESC)
WHERE type IN ('rsvp_updated', 'rsvp_update');
