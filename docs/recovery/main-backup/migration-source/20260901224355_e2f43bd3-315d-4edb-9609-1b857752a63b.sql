INSERT INTO public.app_settings (key, value, description)
VALUES (
  'chat_recap_enabled',
  'true'::jsonb,
  'Master kill-switch for the AI Chat Recap feature. When false, Chat Recap is hidden and unavailable for every club and user, regardless of club or personal settings.'
)
ON CONFLICT (key) DO NOTHING;