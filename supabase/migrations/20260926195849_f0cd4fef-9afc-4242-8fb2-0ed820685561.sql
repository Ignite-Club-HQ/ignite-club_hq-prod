CREATE OR REPLACE FUNCTION public.sync_competition_coord_chat_members(_competition_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_group_id uuid; v_created_by uuid;
BEGIN
  SELECT id INTO v_group_id FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = 'coordinators';
  IF v_group_id IS NULL THEN RETURN; END IF;
  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, q.user_id, COALESCE(v_created_by, q.user_id) FROM (
    SELECT ur.user_id FROM public.competition_entries ce
    JOIN public.user_roles ur ON ur.team_id = ce.team_id AND ur.role = 'team_admin'
    WHERE ce.competition_id = _competition_id AND ce.status IN ('invited','accepted')
    UNION
    SELECT cr.user_id FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id AND cr.role IN ('owner','admin')
  ) q ON CONFLICT DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_entries ce
      JOIN public.user_roles ur ON ur.team_id = ce.team_id AND ur.role = 'team_admin'
      WHERE ce.competition_id = _competition_id AND ce.status IN ('invited','accepted') AND ur.user_id = gm.user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id AND cr.user_id = gm.user_id AND cr.role IN ('owner','admin'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_competition_role_chat_members(_competition_id uuid, _scope text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_group_id uuid; v_created_by uuid; v_role text;
BEGIN
  v_role := CASE _scope WHEN 'referees' THEN 'referee' WHEN 'committee' THEN 'committee' ELSE NULL END;
  IF v_role IS NULL THEN RETURN; END IF;
  SELECT id INTO v_group_id FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = _scope;
  IF v_group_id IS NULL THEN RETURN; END IF;
  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  -- Role holders plus competition owners/admins.
  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT DISTINCT v_group_id, cr.user_id, COALESCE(v_created_by, cr.user_id)
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id AND cr.role IN (v_role, 'owner', 'admin')
  ON CONFLICT DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id AND cr.user_id = gm.user_id
        AND cr.role IN (v_role, 'owner', 'admin'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_competition_role_sync_chat()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp_id uuid;
BEGIN
  v_comp_id := COALESCE(NEW.competition_id, OLD.competition_id);
  PERFORM public.ensure_competition_coord_chat(v_comp_id);
  PERFORM public.sync_competition_coord_chat_members(v_comp_id);
  PERFORM public.sync_competition_member_chat_members(v_comp_id);
  PERFORM public.ensure_competition_role_chat(v_comp_id, 'referees');
  PERFORM public.ensure_competition_role_chat(v_comp_id, 'committee');
  PERFORM public.sync_competition_role_chat_members(v_comp_id, 'referees');
  PERFORM public.sync_competition_role_chat_members(v_comp_id, 'committee');
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT competition_id FROM public.chat_groups WHERE competition_id IS NOT NULL LOOP
    PERFORM public.sync_competition_coord_chat_members(r.competition_id);
    PERFORM public.sync_competition_role_chat_members(r.competition_id, 'referees');
    PERFORM public.sync_competition_role_chat_members(r.competition_id, 'committee');
  END LOOP;
END $$;