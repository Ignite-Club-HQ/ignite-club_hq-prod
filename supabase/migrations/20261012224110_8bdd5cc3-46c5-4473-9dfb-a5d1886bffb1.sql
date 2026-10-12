ALTER TABLE public.competition_role_links
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_uses integer,
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_competition_role_link_status(p_token text)
RETURNS TABLE(status text, competition_id uuid, competition_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l record; v_name text;
BEGIN
  SELECT * INTO l FROM public.competition_role_links WHERE token = p_token;
  IF l.id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT c.name INTO v_name FROM public.competitions c WHERE c.id = l.competition_id;
  RETURN QUERY SELECT
    CASE WHEN l.expires_at IS NOT NULL AND l.expires_at <= now() THEN 'expired'
         WHEN l.max_uses IS NOT NULL AND l.use_count >= l.max_uses THEN 'used_up'
         ELSE 'valid' END,
    l.competition_id, v_name, l.role;
END $$;
REVOKE ALL ON FUNCTION public.get_competition_role_link_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_role_link_status(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_competition_role_link(p_token text)
RETURNS TABLE(status text, competition_id uuid, chat_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := auth.uid(); l record; v_club uuid; v_name text; v_scope text; v_chat uuid; v_status text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO l FROM public.competition_role_links WHERE token = p_token FOR UPDATE;
  IF l.id IS NULL THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN; END IF;
  v_scope := CASE l.role WHEN 'referee' THEN 'referees' ELSE 'committee' END;

  IF EXISTS (SELECT 1 FROM public.competition_roles cr
             WHERE cr.competition_id = l.competition_id AND cr.user_id = v_me AND cr.role = l.role) THEN
    v_status := 'already';
  ELSIF l.expires_at IS NOT NULL AND l.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, l.competition_id, NULL::uuid; RETURN;
  ELSIF l.max_uses IS NOT NULL AND l.use_count >= l.max_uses THEN
    RETURN QUERY SELECT 'used_up'::text, l.competition_id, NULL::uuid; RETURN;
  ELSE
    SELECT organizer_club_id, name INTO v_club, v_name FROM public.competitions WHERE id = l.competition_id;
    INSERT INTO public.competition_roles (competition_id, user_id, role) VALUES (l.competition_id, v_me, l.role);
    UPDATE public.competition_role_links SET use_count = use_count + 1 WHERE id = l.id;
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    VALUES (v_me, 'membership', 'You have been added as a '
      || CASE l.role WHEN 'referee' THEN 'referee' ELSE 'committee member' END || ' for ' || v_name,
      l.competition_id, v_club);
    v_status := 'joined';
  END IF;

  -- Role row drives chat membership via the existing sync trigger; make sure it is in place.
  SELECT g.id INTO v_chat FROM public.chat_groups g
   WHERE g.competition_id = l.competition_id AND g.competition_scope = v_scope AND g.deleted_at IS NULL LIMIT 1;
  IF v_chat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = v_chat AND gm.user_id = v_me) THEN
    INSERT INTO public.group_members (group_id, user_id) VALUES (v_chat, v_me);
  END IF;

  RETURN QUERY SELECT v_status, l.competition_id, v_chat;
END $$;
REVOKE ALL ON FUNCTION public.accept_competition_role_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_competition_role_link(text) TO authenticated;