-- Enum for chat type
DO $$ BEGIN
  CREATE TYPE public.scheduled_chat_type AS ENUM (
    'team', 'club', 'group', 'direct', 'club_admin', 'broadcast'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scheduled_message_status AS ENUM (
    'pending', 'sent', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  chat_type public.scheduled_chat_type NOT NULL,

  -- Exactly one of these is set, depending on chat_type
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  club_id uuid REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  conversation_id uuid, -- direct_conversations OR club_admin_conversations

  text text NOT NULL DEFAULT '',
  image_url text,
  reply_to_id uuid,

  scheduled_for timestamptz NOT NULL,
  status public.scheduled_message_status NOT NULL DEFAULT 'pending',

  sent_message_id uuid,
  error_message text,
  attempted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Must have content (text or image)
  CONSTRAINT scheduled_messages_has_content CHECK (
    length(coalesce(text, '')) > 0 OR image_url IS NOT NULL
  ),

  -- Right destination column for the chat_type
  CONSTRAINT scheduled_messages_destination_matches_type CHECK (
    (chat_type = 'team'        AND team_id IS NOT NULL AND club_id IS NULL AND group_id IS NULL AND conversation_id IS NULL) OR
    (chat_type = 'club'        AND club_id IS NOT NULL AND team_id IS NULL AND group_id IS NULL AND conversation_id IS NULL) OR
    (chat_type = 'group'       AND group_id IS NOT NULL AND team_id IS NULL AND club_id IS NULL AND conversation_id IS NULL) OR
    (chat_type = 'direct'      AND conversation_id IS NOT NULL AND team_id IS NULL AND club_id IS NULL AND group_id IS NULL) OR
    (chat_type = 'club_admin'  AND conversation_id IS NOT NULL AND team_id IS NULL AND club_id IS NULL AND group_id IS NULL) OR
    (chat_type = 'broadcast'   AND team_id IS NULL AND club_id IS NULL AND group_id IS NULL AND conversation_id IS NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_worker
  ON public.scheduled_messages (status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_author
  ON public.scheduled_messages (author_id, status, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_team    ON public.scheduled_messages (team_id)    WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_club    ON public.scheduled_messages (club_id)    WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_group   ON public.scheduled_messages (group_id)   WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conv    ON public.scheduled_messages (conversation_id) WHERE conversation_id IS NOT NULL;

-- Validation trigger: enforce future date on insert; lock fields once not pending
CREATE OR REPLACE FUNCTION public.scheduled_messages_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_for <= now() THEN
      RAISE EXCEPTION 'scheduled_for must be in the future';
    END IF;
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'new scheduled messages must start as pending';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Once a row is no longer pending, only the worker (service role) may touch it.
    IF OLD.status <> 'pending' AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'cannot modify a scheduled message that is no longer pending';
    END IF;

    -- If still pending and rescheduled, must remain in the future
    IF NEW.status = 'pending' AND NEW.scheduled_for <> OLD.scheduled_for AND NEW.scheduled_for <= now() THEN
      RAISE EXCEPTION 'scheduled_for must be in the future';
    END IF;

    NEW.updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduled_messages_validate_trg ON public.scheduled_messages;
CREATE TRIGGER scheduled_messages_validate_trg
  BEFORE INSERT OR UPDATE ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_messages_validate();

-- RLS
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authors can view their own scheduled messages"
  ON public.scheduled_messages FOR SELECT TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "Authors can create their own scheduled messages"
  ON public.scheduled_messages FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can update their own pending scheduled messages"
  ON public.scheduled_messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND status = 'pending')
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can delete their own pending scheduled messages"
  ON public.scheduled_messages FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND status = 'pending');