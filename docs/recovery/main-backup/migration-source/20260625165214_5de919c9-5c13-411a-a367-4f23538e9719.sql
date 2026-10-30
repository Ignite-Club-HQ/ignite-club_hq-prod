DO $$ BEGIN
  CREATE TYPE public.message_digest_classification AS ENUM ('action','question','decision','social','info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.message_digest_source AS ENUM ('club','team','group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.message_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  message_type public.message_digest_source NOT NULL,
  chat_scope_id uuid NOT NULL,
  message_created_at timestamptz NOT NULL,
  classification public.message_digest_classification NOT NULL DEFAULT 'info',
  summary text NOT NULL DEFAULT '',
  topic text,
  mentions_user_ids uuid[] NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  digested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_type, message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_digests_scope_created
  ON public.message_digests (message_type, chat_scope_id, message_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_digests_classification
  ON public.message_digests (chat_scope_id, classification, message_created_at DESC);

GRANT SELECT ON public.message_digests TO authenticated;
GRANT ALL ON public.message_digests TO service_role;

ALTER TABLE public.message_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read digests for accessible chats"
ON public.message_digests
FOR SELECT
TO authenticated
USING (
  CASE message_type
    WHEN 'group' THEN public.can_access_chat_group(chat_scope_id, auth.uid())
    WHEN 'club'  THEN public.has_role(auth.uid(), 'app_admin') OR EXISTS (
      SELECT 1 FROM public.team_memberships tm
      JOIN public.club_players cp ON cp.id = tm.club_player_id
      WHERE cp.profile_id = auth.uid()
        AND cp.club_id = message_digests.chat_scope_id
        AND tm.status = 'active'
    )
    WHEN 'team'  THEN public.has_role(auth.uid(), 'app_admin') OR EXISTS (
      SELECT 1 FROM public.team_memberships tm
      JOIN public.club_players cp ON cp.id = tm.club_player_id
      WHERE cp.profile_id = auth.uid()
        AND tm.team_id = message_digests.chat_scope_id
        AND tm.status = 'active'
    )
  END
);

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'digest_worker_enabled',
  'false'::jsonb,
  'Master switch for the message_digests background classifier. When true, the digest-messages cron runs.'
)
ON CONFLICT (key) DO NOTHING;