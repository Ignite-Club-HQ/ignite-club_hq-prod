CREATE OR REPLACE FUNCTION public.can_rename_competition_chat(_user_id uuid, _group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_groups g
    JOIN public.competition_roles cr ON cr.competition_id = g.competition_id
    WHERE g.id = _group_id AND g.deleted_at IS NULL
      AND cr.user_id = _user_id AND cr.role IN ('owner','admin')
  )
$$;
REVOKE ALL ON FUNCTION public.can_rename_competition_chat(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_rename_competition_chat(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rename_competition_chat(_group_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text := btrim(coalesce(_name,''));
BEGIN
  IF NOT public.can_rename_competition_chat(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not allowed to rename this chat' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) = 0 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Chat name must be 1-100 characters';
  END IF;
  UPDATE public.chat_groups SET name = v_name, updated_at = now() WHERE id = _group_id;
END $$;
REVOKE ALL ON FUNCTION public.rename_competition_chat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_competition_chat(uuid, text) TO authenticated, service_role;