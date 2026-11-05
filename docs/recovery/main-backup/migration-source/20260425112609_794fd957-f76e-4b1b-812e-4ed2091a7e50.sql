
CREATE TABLE public.gallery_chat_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL,
  message_id UUID NOT NULL REFERENCES public.team_messages(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  hero_photo_id UUID REFERENCES public.photos(id) ON DELETE SET NULL,
  hero_image_url TEXT,
  photo_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  photo_count INT NOT NULL DEFAULT 0,
  push_sent BOOLEAN NOT NULL DEFAULT false,
  is_prompt BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gallery_chat_cards_team_uploader_recent
  ON public.gallery_chat_cards (team_id, uploader_id, updated_at DESC);
CREATE INDEX idx_gallery_chat_cards_message ON public.gallery_chat_cards (message_id);
CREATE INDEX idx_gallery_chat_cards_event ON public.gallery_chat_cards (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.gallery_chat_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view gallery cards"
ON public.gallery_chat_cards
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.team_id = gallery_chat_cards.team_id
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.user_roles ur ON ur.club_id = t.club_id
    WHERE t.id = gallery_chat_cards.team_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('club_admin','app_admin','committee_member')
  )
  OR public.has_role(auth.uid(), 'app_admin')
);

CREATE POLICY "No direct writes" ON public.gallery_chat_cards
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER gallery_chat_cards_set_updated_at
BEFORE UPDATE ON public.gallery_chat_cards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.post_or_update_team_gallery_card(
  _team_id UUID,
  _photo_ids UUID[],
  _hero_photo_id UUID,
  _hero_image_url TEXT,
  _event_id UUID DEFAULT NULL
) RETURNS TABLE(card_id UUID, message_id UUID, total_count INT, was_new BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_existing public.gallery_chat_cards%ROWTYPE;
  v_card_id UUID;
  v_message_id UUID;
  v_combined UUID[];
  v_count INT;
  v_message_text TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.team_id = _team_id
  ) AND NOT public.has_role(v_user, 'app_admin')
    AND NOT EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.user_roles ur ON ur.club_id = t.club_id
      WHERE t.id = _team_id AND ur.user_id = v_user
        AND ur.role IN ('club_admin','coach','committee_member')
    )
  THEN
    RAISE EXCEPTION 'Not authorized for this team';
  END IF;

  IF _photo_ids IS NULL OR array_length(_photo_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No photos provided';
  END IF;

  SELECT * INTO v_existing
  FROM public.gallery_chat_cards
  WHERE team_id = _team_id
    AND uploader_id = v_user
    AND is_prompt = false
    AND updated_at > now() - INTERVAL '10 minutes'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT ARRAY(SELECT DISTINCT unnest(v_existing.photo_ids || _photo_ids)) INTO v_combined;
    v_count := COALESCE(array_length(v_combined, 1), 0);

    UPDATE public.gallery_chat_cards
    SET photo_ids = v_combined,
        photo_count = v_count,
        event_id = COALESCE(_event_id, event_id),
        updated_at = now()
    WHERE id = v_existing.id;

    v_message_text := '[gallery:' || v_existing.id || ']';
    UPDATE public.team_messages SET text = v_message_text WHERE id = v_existing.message_id;

    RETURN QUERY SELECT v_existing.id, v_existing.message_id, v_count, false;
    RETURN;
  END IF;

  v_card_id := gen_random_uuid();
  v_count := COALESCE(array_length(_photo_ids, 1), 0);
  v_message_text := '[gallery:' || v_card_id || ']';

  INSERT INTO public.team_messages(team_id, author_id, text, is_system_message)
  VALUES (_team_id, v_user, v_message_text, true)
  RETURNING id INTO v_message_id;

  INSERT INTO public.gallery_chat_cards(
    id, team_id, uploader_id, message_id, event_id,
    hero_photo_id, hero_image_url, photo_ids, photo_count
  ) VALUES (
    v_card_id, _team_id, v_user, v_message_id, _event_id,
    _hero_photo_id, _hero_image_url, _photo_ids, v_count
  );

  RETURN QUERY SELECT v_card_id, v_message_id, v_count, true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_or_update_team_gallery_card(UUID, UUID[], UUID, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_gallery_card_push_sent(_card_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gallery_chat_cards
  SET push_sent = true
  WHERE id = _card_id AND uploader_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_gallery_card_push_sent(UUID) TO authenticated;
