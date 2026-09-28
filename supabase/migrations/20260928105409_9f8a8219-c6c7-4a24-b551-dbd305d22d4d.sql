-- ===== 1. ensure_competition_coord_chat: name as 'Coordinators – <Competition>' =====
CREATE OR REPLACE FUNCTION public.ensure_competition_coord_chat(_competition_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_comp record;
BEGIN
  SELECT id, name, created_by INTO v_comp
  FROM public.competitions WHERE id = _competition_id;

  IF v_comp.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = 'coordinators';
  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  INSERT INTO public.chat_groups (
    name, club_id, team_id, mini_league_id, competition_id, competition_scope,
    allowed_roles, created_by, membership_mode
  ) VALUES (
    'Coordinators – ' || v_comp.name,
    NULL, NULL, NULL, v_comp.id, 'coordinators',
    ARRAY[]::app_role[], v_comp.created_by, 'manual'
  )
  RETURNING id INTO v_group_id;

  PERFORM public.sync_competition_coord_chat_members(_competition_id);

  RETURN v_group_id;
END;
$function$;

-- ===== 2. ensure_competition_member_chat: name as 'All Members – <Competition>' =====
CREATE OR REPLACE FUNCTION public.ensure_competition_member_chat(_competition_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_comp record;
BEGIN
  SELECT id, name, created_by, member_chat_enabled INTO v_comp
  FROM public.competitions WHERE id = _competition_id;

  IF v_comp.id IS NULL OR NOT v_comp.member_chat_enabled THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = 'all_members';

  IF v_group_id IS NOT NULL THEN
    UPDATE public.chat_groups
       SET deleted_at = NULL, updated_at = now()
     WHERE id = v_group_id AND deleted_at IS NOT NULL;
  ELSE
    INSERT INTO public.chat_groups (
      name, club_id, team_id, mini_league_id, competition_id, competition_scope,
      allowed_roles, created_by, membership_mode
    ) VALUES (
      'All Members – ' || v_comp.name,
      NULL, NULL, NULL, v_comp.id, 'all_members',
      ARRAY[]::app_role[], v_comp.created_by, 'manual'
    )
    RETURNING id INTO v_group_id;
  END IF;

  PERFORM public.sync_competition_member_chat_members(_competition_id);

  RETURN v_group_id;
END;
$function$;

-- ===== 3. ensure_competition_role_chat: name as '<Role> – <Competition>' =====
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
  v_prefix text;
  v_has_holder boolean;
BEGIN
  v_role := CASE _scope WHEN 'referees' THEN 'referee' WHEN 'committee' THEN 'committee' ELSE NULL END;
  v_prefix := CASE _scope WHEN 'referees' THEN 'Referees – ' WHEN 'committee' THEN 'Committee – ' ELSE NULL END;
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
      v_prefix || v_comp.name,
      NULL, NULL, NULL, v_comp.id, _scope,
      ARRAY[]::app_role[], v_comp.created_by, 'manual'
    )
    RETURNING id INTO v_group_id;
  END IF;

  PERFORM public.sync_competition_role_chat_members(_competition_id, _scope);

  RETURN v_group_id;
END;
$function$;

-- ===== 4. tg_competition_rename_coord_chat: rename all four in the new order =====
CREATE OR REPLACE FUNCTION public.tg_competition_rename_coord_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_groups
       SET name = 'Coordinators – ' || NEW.name, updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'coordinators';

    UPDATE public.chat_groups
       SET name = 'All Members – ' || NEW.name, updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'all_members';

    UPDATE public.chat_groups
       SET name = 'Referees – ' || NEW.name, updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'referees';

    UPDATE public.chat_groups
       SET name = 'Committee – ' || NEW.name, updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'committee';
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== 5. Backfill: rename existing competition chat groups in place =====
UPDATE public.chat_groups cg
SET name = CASE cg.competition_scope
      WHEN 'coordinators' THEN 'Coordinators – ' || comp.name
      WHEN 'all_members'  THEN 'All Members – ' || comp.name
      WHEN 'referees'     THEN 'Referees – ' || comp.name
      WHEN 'committee'    THEN 'Committee – ' || comp.name
    END,
    updated_at = now()
FROM public.competitions comp
WHERE cg.competition_id = comp.id
  AND cg.competition_scope IN ('coordinators','all_members','referees','committee');