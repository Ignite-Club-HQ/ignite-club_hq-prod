UPDATE public.profiles p
SET ai_catch_up_acknowledged_at = COALESCE(p.ai_catch_up_acknowledged_at, now())
WHERE p.ai_catch_up_acknowledged_at IS NULL
  AND EXISTS (SELECT 1 FROM public.chat_summaries s WHERE s.user_id = p.id);