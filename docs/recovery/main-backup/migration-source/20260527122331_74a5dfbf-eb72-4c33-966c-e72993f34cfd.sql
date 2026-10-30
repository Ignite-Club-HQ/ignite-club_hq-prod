DELETE FROM public.notifications
WHERE type = 'club_admin_message'
  AND related_id IN (
    SELECT id FROM public.club_admin_messages
    WHERE conversation_id = '3769e636-1ad7-433b-9de5-bc478d1036f3'
  );