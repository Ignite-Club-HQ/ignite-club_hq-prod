
GRANT SELECT ON public.app_ads TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_ads TO authenticated;
GRANT ALL ON public.app_ads TO service_role;

GRANT SELECT ON public.app_ad_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_ad_settings TO authenticated;
GRANT ALL ON public.app_ad_settings TO service_role;
