INSERT INTO public.app_ad_settings (location, is_enabled, override_sponsors, show_only_when_no_sponsors)
VALUES ('schedule', true, false, true)
ON CONFLICT (location) DO UPDATE SET is_enabled = true;