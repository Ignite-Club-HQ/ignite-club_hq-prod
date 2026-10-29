-- Explicit deny-all policies so the server-only intent is documented
-- (RLS already blocked all client access; this silences the linter and
--  makes the guarantee explicit).
CREATE POLICY welcome_email_deliveries_no_client_access
  ON public.welcome_email_deliveries FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY icp_welcome_email_deliveries_no_client_access
  ON public.icp_welcome_email_deliveries FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Eligibility check becomes service-role only; the send-welcome-email edge
-- function calls it via the admin client after verifying the caller's session
-- and that recipientUserId matches the caller.
REVOKE EXECUTE ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) TO service_role;