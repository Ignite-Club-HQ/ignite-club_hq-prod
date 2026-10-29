-- ============================================================
-- DEV compatibility: welcome-email delivery contract + Realtime gaps
-- Source: hybrid migrations 20261012020000 / 20261013000000 (delivery
-- portions only; welcome_email_settings already exists on DEV).
-- ============================================================

-- 1) Welcome email deliveries (server-only tracking table)
CREATE TABLE public.welcome_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('team', 'competition')),
  scope_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.welcome_email_deliveries FROM anon, authenticated;
GRANT ALL ON public.welcome_email_deliveries TO service_role;
ALTER TABLE public.welcome_email_deliveries ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated have no access; service_role bypasses RLS.

-- 2) Recipient eligibility check (signed-in caller must be the recipient)
CREATE OR REPLACE FUNCTION public.is_welcome_email_recipient(
  _scope_kind text,
  _scope_id uuid,
  _recipient_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid() = _recipient_user_id
    AND CASE _scope_kind
      WHEN 'team' THEN
        EXISTS (
          SELECT 1 FROM public.user_roles role
          WHERE role.team_id = _scope_id AND role.user_id = _recipient_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.team_memberships membership
          JOIN public.club_players player ON player.id = membership.club_player_id
          WHERE membership.team_id = _scope_id
            AND membership.status = 'active'
            AND membership.removed_at IS NULL
            AND player.is_active
            AND player.profile_id = _recipient_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.child_team_assignments assignment
          JOIN public.children child ON child.id = assignment.child_id
          WHERE assignment.team_id = _scope_id
            AND (
              child.parent_id = _recipient_user_id
              OR EXISTS (
                SELECT 1 FROM public.child_guardians guardian
                WHERE guardian.child_id = child.id
                  AND guardian.guardian_id = _recipient_user_id
              )
            )
        )
      WHEN 'competition' THEN public.can_access_competition_vault(_scope_id)
      ELSE false
    END;
$$;

-- 3) Claim / finish delivery (service role only)
CREATE OR REPLACE FUNCTION public.claim_welcome_email_delivery(
  _dedupe_key text,
  _scope_kind text,
  _scope_id uuid,
  _recipient_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery_id uuid;
BEGIN
  INSERT INTO public.welcome_email_deliveries (
    dedupe_key, scope_kind, scope_id, recipient_user_id, status, attempts, locked_at
  ) VALUES (
    _dedupe_key, _scope_kind, _scope_id, _recipient_user_id, 'processing', 1, now()
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET status = 'processing', attempts = welcome_email_deliveries.attempts + 1,
        locked_at = now(), updated_at = now(), last_error = NULL
    WHERE welcome_email_deliveries.status IN ('pending', 'failed')
       OR (welcome_email_deliveries.status = 'processing'
           AND welcome_email_deliveries.locked_at < now() - interval '10 minutes')
  RETURNING id INTO delivery_id;

  RETURN delivery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_welcome_email_delivery(
  _delivery_id uuid,
  _sent boolean,
  _provider_message_id text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.welcome_email_deliveries
  SET status = CASE WHEN _sent THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN _sent THEN now() ELSE sent_at END,
      provider_message_id = CASE WHEN _sent THEN _provider_message_id ELSE provider_message_id END,
      last_error = CASE WHEN _sent THEN NULL ELSE left(COALESCE(_error, 'Delivery failed'), 500) END,
      locked_at = NULL,
      updated_at = now()
  WHERE id = _delivery_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_welcome_email_delivery(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_welcome_email_delivery(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_email_delivery(text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_welcome_email_delivery(uuid, boolean, text, text) TO service_role;

-- 4) ICP welcome email deliveries (server-only)
CREATE TABLE public.icp_welcome_email_deliveries (
  invite_id text PRIMARY KEY CHECK (char_length(invite_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.icp_welcome_email_deliveries FROM anon, authenticated;
GRANT ALL ON public.icp_welcome_email_deliveries TO service_role;
ALTER TABLE public.icp_welcome_email_deliveries ENABLE ROW LEVEL SECURITY;
-- No policies: server-only via service_role.

CREATE OR REPLACE FUNCTION public.claim_icp_welcome_email(_invite_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed text;
BEGIN
  INSERT INTO public.icp_welcome_email_deliveries (invite_id, locked_at)
  VALUES (_invite_id, now())
  ON CONFLICT (invite_id) DO UPDATE
    SET status = 'processing',
        attempts = icp_welcome_email_deliveries.attempts + 1,
        locked_at = now(),
        updated_at = now(),
        last_error = NULL
    WHERE icp_welcome_email_deliveries.status = 'failed'
       OR (icp_welcome_email_deliveries.status = 'processing'
           AND icp_welcome_email_deliveries.locked_at < now() - interval '10 minutes')
  RETURNING invite_id INTO claimed;

  RETURN claimed IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_icp_welcome_email(
  _invite_id text,
  _sent boolean,
  _provider_message_id text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.icp_welcome_email_deliveries
  SET status = CASE WHEN _sent THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN _sent THEN now() ELSE sent_at END,
      provider_message_id = CASE WHEN _sent THEN _provider_message_id ELSE provider_message_id END,
      last_error = CASE WHEN _sent THEN NULL ELSE left(COALESCE(_error, 'Delivery failed'), 500) END,
      locked_at = NULL,
      updated_at = now()
  WHERE invite_id = _invite_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_icp_welcome_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_icp_welcome_email(text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_icp_welcome_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_icp_welcome_email(text, boolean, text, text) TO service_role;

-- 5) Realtime publication gaps: DEV code subscribes to all three tables
-- (useRemoteFillInSync, BoardLinkCard, AdminActiveGamesPage -> active_games;
--  useChatPinnedVault -> chat_pinned_vault; ClubUpgradePage -> club_subscriptions)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'active_games') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_games;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_pinned_vault') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_pinned_vault;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'club_subscriptions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.club_subscriptions;
  END IF;
END;
$$;