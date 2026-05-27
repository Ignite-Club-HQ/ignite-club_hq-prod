WITH target_groups AS (
  SELECT id FROM public.chat_groups
  WHERE club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422'
    AND lower(category) IN ('operations','volunteers')
),
stale_ids AS (
  SELECT n.id
  FROM public.notifications n
  JOIN target_groups g
    ON n.related_id = g.id
    OR n.related_id IN (SELECT m.id FROM public.group_messages m WHERE m.group_id = g.id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = g.id AND gm.user_id = n.user_id
  )
)
DELETE FROM public.notifications WHERE id IN (SELECT id FROM stale_ids);