INSERT INTO public.app_settings (key, value, description)
VALUES (
  'chat_virtualization_enabled',
  'true'::jsonb,
  'Master kill-switch for chat message virtualisation. When false, all chat pages fall back to a basic mapped scroller showing only the most recent 100 messages. Use as an emergency lever if virtualisation is causing freezes.'
)
ON CONFLICT (key) DO NOTHING;