REVOKE EXECUTE ON FUNCTION public.email_signup_invite_allowed(text,text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;