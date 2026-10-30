DELETE FROM public.notifications
WHERE related_id = '9e5fe76c-84f2-41ed-b382-1e1b64a25de9'
  AND type = 'event_invite'
  AND user_id NOT IN (
    'f51dd664-b0d5-4956-b2d5-cec9222ae3dc',
    '56e09094-602e-4c04-a5f7-94f7b76ff69b'
  );