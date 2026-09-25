CREATE OR REPLACE FUNCTION public.is_competition_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id AND cr.user_id = _user_id AND cr.role IN ('owner','admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = _competition_id AND public.can_organise_competition(_user_id, c.organizer_club_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.competitions c
    JOIN public.clubs cl ON cl.id = c.organizer_club_id
    WHERE c.id = _competition_id
      AND (public.is_association_admin(_user_id, cl.id)
        OR (cl.parent_org_id IS NOT NULL AND public.is_association_admin(_user_id, cl.parent_org_id)))
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_competition_admin(uuid, uuid) TO PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_competition_role_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.competition_roles
    WHERE user_id = _user_id AND competition_id = _competition_id AND role IN ('owner','admin'))
$$;
REVOKE ALL ON FUNCTION public.is_competition_role_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_competition_role_admin(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_competition_admin_conversation(_user_id uuid, _conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.competition_admin_conversations c
    WHERE c.id = _conversation_id AND (
      c.member_user_id = _user_id
      OR public.is_competition_role_admin(_user_id, c.competition_id)
      OR public.has_role(_user_id, 'app_admin')))
$$;

DROP POLICY "Member or competition admins view conversation" ON public.competition_admin_conversations;
CREATE POLICY "Member or competition admins view conversation" ON public.competition_admin_conversations
FOR SELECT TO authenticated USING (
  member_user_id = auth.uid()
  OR public.is_competition_role_admin(auth.uid(), competition_id)
  OR public.has_role(auth.uid(), 'app_admin')
);

CREATE OR REPLACE FUNCTION public.get_or_create_competition_admin_conversation(p_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT id INTO v_id FROM competition_admin_conversations
   WHERE competition_id = p_competition_id AND member_user_id = v_uid;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF public.is_competition_role_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'You are an admin of this competition';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM competition_roles WHERE competition_id = p_competition_id
            AND user_id = v_uid AND role IN ('referee','committee','scorer'))
    OR EXISTS (SELECT 1 FROM competition_entries ce JOIN user_roles ur ON ur.team_id = ce.team_id
            WHERE ce.competition_id = p_competition_id AND ce.status IN ('invited','accepted')
              AND ur.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'You are not part of this competition';
  END IF;
  INSERT INTO competition_admin_conversations (competition_id, member_user_id)
  VALUES (p_competition_id, v_uid) RETURNING id INTO v_id;
  RETURN v_id;
END $$;