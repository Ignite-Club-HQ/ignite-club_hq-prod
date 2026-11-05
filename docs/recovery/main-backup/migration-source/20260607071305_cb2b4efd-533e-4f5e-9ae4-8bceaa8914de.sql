DELETE FROM public.team_messages tm
WHERE tm.is_system_message = true
  AND tm.text LIKE '% joined as %'
  AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.bot_user_id = tm.author_id);

DELETE FROM public.group_messages gm
WHERE gm.is_system_message = true
  AND gm.text LIKE '% joined as %'
  AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.bot_user_id = gm.author_id);