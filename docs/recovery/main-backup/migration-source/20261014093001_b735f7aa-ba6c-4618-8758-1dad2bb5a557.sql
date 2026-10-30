CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_author ON public.direct_messages (author_id, conversation_id);

CREATE OR REPLACE FUNCTION public.can_read_general_chat_attachment(_user_id uuid, _name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE seg text[] := string_to_array(_name, '/'); v_author uuid;
BEGIN
  IF _user_id IS NULL OR seg[1] IS DISTINCT FROM 'general' OR seg[2] IS NULL THEN RETURN false; END IF;
  IF seg[2] = _user_id::text THEN RETURN true; END IF;
  BEGIN v_author := seg[2]::uuid; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN EXISTS (
      SELECT 1 FROM public.group_messages gm
      WHERE gm.author_id = v_author AND gm.deleted_at IS NULL
        AND gm.image_url LIKE '%/chat-attachments/' || _name || '%'
        AND public.can_access_chat_group(_user_id, gm.group_id))
    OR EXISTS (
      SELECT 1 FROM public.direct_messages dm
      JOIN public.direct_conversations dc ON dc.id = dm.conversation_id
      WHERE dm.author_id = v_author AND dm.deleted_at IS NULL
        AND dm.image_url LIKE '%/chat-attachments/' || _name || '%'
        AND _user_id IN (dc.participant_1, dc.participant_2));
END $$;
REVOKE ALL ON FUNCTION public.can_read_general_chat_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_general_chat_attachment(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_chat_attachment(_name text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    ((storage.foldername(_name))[1] = 'general' AND (storage.foldername(_name))[2] = auth.uid()::text)
    OR ((storage.foldername(_name))[1] = 'general' AND public.can_read_general_chat_attachment(auth.uid(), _name))
    OR ((storage.foldername(_name))[1] = 'clubs' AND EXISTS (
        SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
          AND ur.club_id = ((storage.foldername(_name))[2])::uuid))
    OR ((storage.foldername(_name))[1] != 'clubs' AND (storage.foldername(_name))[1] != 'general'
        AND (storage.foldername(_name))[1] = auth.uid()::text)
$function$;

CREATE OR REPLACE FUNCTION public.authorize_storage_objects(_user_id uuid, _items jsonb)
 RETURNS TABLE(bucket text, path text, allowed boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; seg text[]; v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  FOR r IN SELECT (i->>'bucket') AS b, (i->>'path') AS p FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) AS i
  LOOP
    v_allowed := false;
    seg := string_to_array(r.p, '/');
    IF r.b = 'chat-attachments' THEN
      IF seg[1] = 'general' THEN
        v_allowed := public.can_read_general_chat_attachment(_user_id, r.p);
      ELSIF seg[1] = 'clubs' THEN
        v_allowed := EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.club_id::text = seg[2]);
      ELSE
        v_allowed := (seg[1] = _user_id::text);
      END IF;
    ELSIF r.b = 'photos' THEN
      v_allowed := EXISTS (
        SELECT 1 FROM public.photos ph
        WHERE (ph.image_url LIKE '%/photos/' || r.p OR ph.file_url LIKE '%/photos/' || r.p)
          AND ph.deleted_at IS NULL
          AND (
            (ph.team_id IS NOT NULL AND (public.is_team_member(_user_id, ph.team_id)
               OR public.has_role(_user_id, 'club_admin', ph.club_id, NULL)
               OR public.has_role(_user_id, 'app_admin', NULL, NULL)))
            OR (ph.team_id IS NULL AND ph.mini_league_id IS NULL AND (public.is_club_member(_user_id, ph.club_id)
               OR public.has_role(_user_id, 'app_admin', NULL, NULL)))
            OR (ph.mini_league_id IS NOT NULL AND (
               EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
                 WHERE ml.id = ph.mini_league_id AND ur.user_id = _user_id
                   AND ur.role = ANY (ARRAY['league_admin','coach','club_admin','app_admin']::app_role[]))
               OR EXISTS (SELECT 1 FROM public.mini_league_players mlp
                 WHERE mlp.mini_league_id = ph.mini_league_id AND mlp.parent_user_id = _user_id)))
            OR ph.uploader_id = _user_id));
    ELSIF r.b = 'avatars' THEN
      v_allowed := true;
    END IF;
    bucket := r.b; path := r.p; allowed := COALESCE(v_allowed, false);
    RETURN NEXT;
  END LOOP;
END;
$function$;