INSERT INTO public.app_settings (key, value)
VALUES ('free_club_polling_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;