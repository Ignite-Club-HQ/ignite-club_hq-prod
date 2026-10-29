REVOKE ALL ON public.club_invite_message_defaults, public.welcome_email_settings, public.canister_memory_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_invite_message_defaults TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.welcome_email_settings TO authenticated;
GRANT SELECT, INSERT ON public.canister_memory_reports TO authenticated;
GRANT ALL ON public.club_invite_message_defaults, public.welcome_email_settings, public.canister_memory_reports TO service_role;