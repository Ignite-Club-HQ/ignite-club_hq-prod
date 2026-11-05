-- 1. Allow the committee role
ALTER TABLE public.competition_roles
  DROP CONSTRAINT IF EXISTS competition_roles_role_check;
ALTER TABLE public.competition_roles
  ADD CONSTRAINT competition_roles_role_check
  CHECK (role IN ('owner','admin','referee','scorer','committee'));

-- 2. Allow the two new chat scopes
ALTER TABLE public.chat_groups
  DROP CONSTRAINT IF EXISTS chat_groups_competition_scope_check;
ALTER TABLE public.chat_groups
  ADD CONSTRAINT chat_groups_competition_scope_check
  CHECK (
    (competition_id IS NULL AND competition_scope IS NULL)
    OR (competition_id IS NOT NULL AND competition_scope IN ('coordinators','all_members','referees','committee'))
  );

-- 3. Role-scoped chat helpers
CREATE OR REPLACE FUNCTION public.sync_competition_role_chat_members(_competition_id uuid, _scope text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_created_by uuid;
  v_role text;
BEGIN
  v_role := CASE _scope WHEN 'referees' THEN 'referee' WHEN 'committee' THEN 'committee' ELSE NULL END;
  IF v_role IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = _scope;
  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, cr.user_id, COALESCE(v_created_by, cr.user_id)
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id
    AND cr.role IN ('owner','admin', v_role)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = gm.user_id
        AND cr.role IN ('owner','admin', v_role)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_competition_role_chat(_competition_id uuid, _scope text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Nobody holds the role: hide the thread but keep its history.
    IF v_group_id IS NOT NULL THEN
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
$$;

REVOKE ALL ON FUNCTION public.sync_competition_role_chat_members(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_competition_role_chat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_competition_role_chat_members(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_competition_role_chat(uuid, text) TO service_role;

-- 4. Role changes keep every competition thread in step
CREATE OR REPLACE FUNCTION public.tg_competition_role_sync_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id uuid;
BEGIN
  v_comp_id := COALESCE(NEW.competition_id, OLD.competition_id);
  PERFORM public.ensure_competition_coord_chat(v_comp_id);
  PERFORM public.sync_competition_coord_chat_members(v_comp_id);
  PERFORM public.sync_competition_member_chat_members(v_comp_id);
  PERFORM public.ensure_competition_role_chat(v_comp_id, 'referees');
  PERFORM public.ensure_competition_role_chat(v_comp_id, 'committee');
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5. Rename keeps all threads in step
CREATE OR REPLACE FUNCTION public.tg_competition_rename_coord_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_groups
       SET name = NEW.name || ' – Coordinators', updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'coordinators';

    UPDATE public.chat_groups
       SET name = NEW.name || ' – All Members', updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'all_members';

    UPDATE public.chat_groups
       SET name = NEW.name || ' – Referees', updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'referees';

    UPDATE public.chat_groups
       SET name = NEW.name || ' – Committee', updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'committee';
  END IF;
  RETURN NEW;
END;
$$;