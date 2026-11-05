-- NON-EXECUTING REVIEW DRAFT. Not a migration; not deployment approval.
-- Submit only through the approved migration mechanism after complete target review.
-- Existing handle_new_user, on_auth_user_created and trg_auto_claim_eois stay untouched.
-- Prerequisite: install a separately reviewed email_signup_invite_allowed(text,text)
-- helper, extracted WITHOUT the old handle_new_user replacement; validate target
-- invitations, expiry, usage bounds, scope conflicts and malformed configuration.
-- Keep helper execution private: no anonymous token/email enumeration endpoint.

CREATE FUNCTION public.enforce_email_signup_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email'
     AND public.email_signup_invite_allowed(
       NEW.raw_user_meta_data->>'email_signup_invite_token', NEW.email
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Email signup requires a valid invitation for an email-enabled club.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_email_signup_invitation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_email_signup_invitation() TO service_role;
CREATE TRIGGER enforce_email_signup_invitation
BEFORE INSERT ON auth.users FOR EACH ROW
EXECUTE FUNCTION public.enforce_email_signup_invitation();

-- Separate access change; verify RLS is enabled and review all target policies first.
-- Existing evidence already shows anon SELECT granted; no table-wide policy added.
CREATE POLICY "Anonymous public routing settings only"
ON public.app_settings FOR SELECT TO anon
USING (key = 'backend_routing_config');

-- No activation INSERT/UPDATE here. Activation needs independent approval and a
-- fresh config read, preserving all other routing properties and checking membership.
-- Owner-supplied PROD IDs to verify against the live target at activation time:
-- 966bdaec-ebf1-46da-b2b3-cc53bf05c422
-- 493ee2e3-c834-487d-93be-d1c8a0dbc4a8