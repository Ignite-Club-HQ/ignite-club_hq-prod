-- Add club_id to notifications (no FK so legacy rows referencing deleted clubs don't block backfill)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS club_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_user_club_unread
  ON public.notifications(user_id, club_id, is_read);

CREATE OR REPLACE FUNCTION public.derive_notification_club_id(_type text, _related_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  IF _related_id IS NULL THEN
    RETURN NULL;
  END IF;

  CASE
    WHEN _type = 'club_message' THEN
      SELECT cm.club_id INTO v_club_id FROM public.club_messages cm WHERE cm.id = _related_id;
      IF v_club_id IS NULL THEN
        SELECT c.id INTO v_club_id FROM public.clubs c WHERE c.id = _related_id;
      END IF;

    WHEN _type = 'team_message' THEN
      SELECT t.club_id INTO v_club_id
      FROM public.team_messages tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.id = _related_id;

    WHEN _type = 'group_message' THEN
      SELECT cg.club_id INTO v_club_id
      FROM public.group_messages gm
      JOIN public.chat_groups cg ON cg.id = gm.group_id
      WHERE gm.id = _related_id;

    WHEN _type = 'direct_message' THEN
      v_club_id := NULL;

    WHEN _type IN ('event_invite','rsvp_updated','rsvp_update','event_reminder','event_updated','event_cancelled','event_view_reminder','duty_assigned','duty_completed','pending_sub','formation_change','player_of_match') THEN
      SELECT COALESCE(e.club_id, t.club_id) INTO v_club_id
      FROM public.events e
      LEFT JOIN public.teams t ON t.id = e.team_id
      WHERE e.id = _related_id;

    WHEN _type IN ('photo_uploaded','photo_comment','photo_reaction','comment_reaction','comment_reply') THEN
      SELECT p.club_id INTO v_club_id FROM public.photos p WHERE p.id = _related_id;

    WHEN _type IN ('member_joined','membership','team_invite') THEN
      SELECT t.club_id INTO v_club_id FROM public.teams t WHERE t.id = _related_id;
      IF v_club_id IS NULL THEN
        SELECT c.id INTO v_club_id FROM public.clubs c WHERE c.id = _related_id;
      END IF;

    WHEN _type IN ('join_request','join_request_approved','join_request_denied','join_request_processed') THEN
      SELECT t.club_id INTO v_club_id FROM public.teams t WHERE t.id = _related_id;
      IF v_club_id IS NULL THEN
        SELECT c.id INTO v_club_id FROM public.clubs c WHERE c.id = _related_id;
      END IF;

    WHEN _type IN ('role_request','role_request_approved','role_request_denied') THEN
      SELECT COALESCE(rr.club_id, t.club_id) INTO v_club_id
      FROM public.role_requests rr
      LEFT JOIN public.teams t ON t.id = rr.team_id
      WHERE rr.id = _related_id;

    WHEN _type IN ('message_reaction','message_reply','message_mention') THEN
      SELECT t.club_id INTO v_club_id FROM public.teams t WHERE t.id = _related_id;
      IF v_club_id IS NULL THEN
        SELECT c.id INTO v_club_id FROM public.clubs c WHERE c.id = _related_id;
      END IF;
      IF v_club_id IS NULL THEN
        SELECT cg.club_id INTO v_club_id FROM public.chat_groups cg WHERE cg.id = _related_id;
      END IF;

    WHEN _type IN ('early_rsvp_points','leaderboard_update','reward_proximity') THEN
      SELECT c.id INTO v_club_id FROM public.clubs c WHERE c.id = _related_id;

    WHEN _type IN ('season_archived','season_published') THEN
      SELECT s.club_id INTO v_club_id FROM public.club_seasons s WHERE s.id = _related_id;

    ELSE
      v_club_id := NULL;
  END CASE;

  RETURN v_club_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_club_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.club_id IS NULL THEN
    NEW.club_id := public.derive_notification_club_id(NEW.type, NEW.related_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_notification_club_id ON public.notifications;
CREATE TRIGGER trg_set_notification_club_id
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.set_notification_club_id();

UPDATE public.notifications n
SET club_id = public.derive_notification_club_id(n.type, n.related_id)
WHERE n.club_id IS NULL;