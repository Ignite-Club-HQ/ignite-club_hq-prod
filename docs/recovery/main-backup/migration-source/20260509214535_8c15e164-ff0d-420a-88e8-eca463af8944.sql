
-- Dedupe log for chat-photo → gallery reminder system messages.
CREATE TABLE IF NOT EXISTS public.chat_photo_gallery_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  author_id UUID NOT NULL,
  message_id UUID,
  photo_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_photo_gallery_reminders_lookup
  ON public.chat_photo_gallery_reminders (team_id, author_id, created_at DESC);

ALTER TABLE public.chat_photo_gallery_reminders ENABLE ROW LEVEL SECURITY;

-- Read: only the targeted author can see their own reminder log entries.
CREATE POLICY "Authors read own chat-photo reminders"
ON public.chat_photo_gallery_reminders
FOR SELECT
USING (auth.uid() = author_id);

-- No client INSERT/UPDATE/DELETE policies — written exclusively by the RPC
-- (SECURITY DEFINER) invoked from the cron edge function (service-role).

-- RPC: post a single nudge system message in a team chat reminding `_author_id`
-- to add their recent chat-shared photos to the team gallery. Dedupes per
-- (team, author) in a rolling 7-day window so we never spam the same person
-- more than once a week even if they keep sharing fresh photos.
CREATE OR REPLACE FUNCTION public.post_chat_photo_gallery_reminder(
  _team_id UUID,
  _author_id UUID,
  _system_user_id UUID,
  _photo_count INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_text TEXT;
  v_author_first TEXT;
BEGIN
  IF _photo_count <= 0 THEN
    RETURN NULL;
  END IF;

  -- Skip if we already nudged this author for this team within the last 7 days.
  IF EXISTS (
    SELECT 1 FROM public.chat_photo_gallery_reminders
    WHERE team_id = _team_id
      AND author_id = _author_id
      AND created_at > now() - INTERVAL '7 days'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT split_part(COALESCE(NULLIF(full_name, ''), 'You'), ' ', 1)
    INTO v_author_first
  FROM public.profiles
  WHERE id = _author_id;

  v_text := '📸 ' || COALESCE(v_author_first, 'You') ||
            CASE WHEN _photo_count = 1
              THEN ' shared a photo in chat — long-press it to add it to the team gallery so it doesn''t get lost.'
              ELSE ' shared ' || _photo_count::text || ' photos in chat — long-press any of them to add them to the team gallery so they don''t get lost.'
            END;

  INSERT INTO public.team_messages(team_id, author_id, text, is_system_message)
  VALUES (_team_id, _system_user_id, v_text, true)
  RETURNING id INTO v_message_id;

  INSERT INTO public.chat_photo_gallery_reminders(team_id, author_id, message_id, photo_count)
  VALUES (_team_id, _author_id, v_message_id, _photo_count);

  RETURN v_message_id;
END;
$$;
