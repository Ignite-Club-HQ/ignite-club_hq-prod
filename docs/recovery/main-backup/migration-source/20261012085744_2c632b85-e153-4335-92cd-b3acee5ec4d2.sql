CREATE OR REPLACE FUNCTION public.can_access_poll_chat(_chat_type poll_chat_type, _chat_id uuid, _user_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ok boolean := false;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _chat_type = 'team' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.team_id = _chat_id)
      OR EXISTS (SELECT 1 FROM public.teams t JOIN public.user_roles ur2 ON ur2.club_id = t.club_id AND ur2.user_id = _user_id
                 WHERE t.id = _chat_id AND ur2.role IN ('club_admin','committee_member','app_admin')) INTO v_ok;
    RETURN v_ok;
  ELSIF _chat_type = 'club' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.club_id = _chat_id) INTO v_ok;
    RETURN v_ok;
  ELSIF _chat_type = 'broadcast' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id) INTO v_ok;
    RETURN v_ok;
  ELSIF _chat_type = 'group' THEN
    -- Same rule that governs reading group_messages (covers competition and mini-league groups).
    RETURN public.can_access_chat_group(_user_id, _chat_id);
  ELSIF _chat_type = 'club_admin' THEN
    SELECT EXISTS (SELECT 1 FROM public.club_admin_conversations c WHERE c.id = _chat_id
      AND (c.member_user_id = _user_id OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
           AND ur.club_id = c.club_id AND ur.role IN ('club_admin','committee_member','app_admin')))) INTO v_ok;
    RETURN v_ok;
  END IF;
  RETURN false;
END;
$function$;

DROP POLICY IF EXISTS "Members can create polls in their chats" ON public.polls;
CREATE POLICY "Members can create polls in their chats" ON public.polls FOR INSERT TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.can_access_poll_chat(chat_type, chat_id, (SELECT auth.uid()))
  AND (chat_type <> 'group' OR public.can_post_in_chat_group((SELECT auth.uid()), chat_id))
);

DROP POLICY IF EXISTS "Members can cast their own votes in accessible, open polls" ON public.poll_votes;
CREATE POLICY "Members can cast their own votes in accessible, open polls" ON public.poll_votes FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_votes.poll_id
    AND public.can_access_poll_chat(p.chat_type, p.chat_id, (SELECT auth.uid()))
    AND (p.chat_type <> 'group' OR public.can_post_in_chat_group((SELECT auth.uid()), p.chat_id))
    AND p.closed_at IS NULL AND (p.closes_at IS NULL OR p.closes_at > now()))
);