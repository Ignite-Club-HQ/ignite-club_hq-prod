
INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push, created_at)
SELECT ur.user_id,
       'club_admin_message',
       'Sam Bond mum of Harry and Otto: ' || LEFT(m.text, 100),
       m.id,
       '966bdaec-ebf1-46da-b2b3-cc53bf05c422'::uuid,
       true,
       m.created_at
FROM public.club_admin_messages m
CROSS JOIN public.user_roles ur
WHERE m.conversation_id = '3769e636-1ad7-433b-9de5-bc478d1036f3'
  AND ur.club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422'
  AND ur.role = 'club_admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = ur.user_id
      AND n.related_id = m.id
      AND n.type = 'club_admin_message'
  );
