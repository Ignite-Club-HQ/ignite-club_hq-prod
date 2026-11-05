CREATE OR REPLACE FUNCTION public.ensure_competition_role_chat(_competition_id uuid, _scope text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_comp record;
  v_role text;
  v_suffix text;
  v_has_holder boolean;
BEGIN
  v_role := CASE _scope WHEN 'referees' THEN 'referee' WHEN 'committee' THEN 'committee' ELSE NULL END;
  v_suffix := CASE _scope WHEN 'referees' THEN ' – Referees' WHEN 'committee' THEN ' – Committee' ELSE NULL END;
  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, name, created_by INTO v_comp
  FROM public.competitions WHERE id = _competition_id;
  IF v_comp.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id AND cr.role = v_role
  ) INTO v_has_holder;

  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = _scope;

  IF NOT v_has_holder THEN
    -- Nobody holds the role: hide the thread but keep its history. Sync first
    -- so former holders lose their membership row, otherwise they would regain
    -- access the moment the thread is reactivated.
    IF v_group_id IS NOT NULL THEN
      PERFORM public.sync_competition_role_chat_members(_competition_id, _scope);
      UPDATE public.chat_groups
         SET deleted_at = now(), updated_at = now()
       WHERE id = v_group_id AND deleted_at IS NULL;
    END IF;
    RETURN v_group_id;
  END IF;

  IF v_group_id IS NOT NULL THEN
    UPDATE public.chat_groups
       SET deleted_at = NULL, updated_at = now()
     WHERE id = v_group_id AND deleted_at IS NOT NULL;
  ELSE
    INSERT INTO public.chat_groups (
      name, club_id, team_id, mini_league_id, competition_id, competition_scope,
      allowed_roles, created_by, membership_mode
    ) VALUES (
      v_comp.name || v_suffix,
      NULL, NULL, NULL, v_comp.id, _scope,
      ARRAY[]::app_role[], v_comp.created_by, 'manual'
    )
    RETURNING id INTO v_group_id;
  END IF;

  PERFORM public.sync_competition_role_chat_members(_competition_id, _scope);

  RETURN v_group_id;
END;
$function$;