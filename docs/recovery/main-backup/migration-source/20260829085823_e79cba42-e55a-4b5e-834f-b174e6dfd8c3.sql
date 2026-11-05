-- 1. Scope discriminator on competition chat groups
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS competition_scope text;

UPDATE public.chat_groups
   SET competition_scope = 'coordinators'
 WHERE competition_id IS NOT NULL AND competition_scope IS NULL;

ALTER TABLE public.chat_groups
  DROP CONSTRAINT IF EXISTS chat_groups_competition_scope_check;
ALTER TABLE public.chat_groups
  ADD CONSTRAINT chat_groups_competition_scope_check
  CHECK (
    (competition_id IS NULL AND competition_scope IS NULL)
    OR (competition_id IS NOT NULL AND competition_scope IN ('coordinators','all_members'))
  );

DROP INDEX IF EXISTS public.chat_groups_competition_unique;
CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_competition_scope_unique
  ON public.chat_groups(competition_id, competition_scope)
  WHERE competition_id IS NOT NULL;

-- 2. Competition-level settings
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS member_chat_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS member_chat_admins_only boolean NOT NULL DEFAULT false;

-- 3. Coordinator chat helpers: scope-aware (behaviour otherwise unchanged)
CREATE OR REPLACE FUNCTION public.sync_competition_coord_chat_members(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_created_by uuid;
BEGIN
  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = 'coordinators';
  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, q.user_id, COALESCE(v_created_by, q.user_id)
  FROM (
    SELECT cr.user_id
    FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.role IN ('owner','admin')
    UNION
    SELECT ur.user_id
    FROM public.competition_entries ce
    JOIN public.user_roles ur ON ur.team_id = ce.team_id AND ur.role = 'team_admin'
    WHERE ce.competition_id = _competition_id
      AND ce.status IN ('invited','accepted')
  ) q
  ON CONFLICT DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = gm.user_id
        AND cr.role IN ('owner','admin')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.competition_entries ce
      JOIN public.user_roles ur ON ur.team_id = ce.team_id AND ur.role = 'team_admin'
      WHERE ce.competition_id = _competition_id
        AND ce.status IN ('invited','accepted')
        AND ur.user_id = gm.user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_competition_coord_chat(_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_comp.name || ' – Coordinators',
    NULL, NULL, NULL, v_comp.id, 'coordinators',
    ARRAY[]::app_role[], v_comp.created_by, 'manual'
  )
  RETURNING id INTO v_group_id;

  PERFORM public.sync_competition_coord_chat_members(_competition_id);

  RETURN v_group_id;
END;
$$;

-- 4. Competition-wide member chat
CREATE OR REPLACE FUNCTION public.sync_competition_member_chat_members(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_created_by uuid;
BEGIN
  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id AND competition_scope = 'all_members';
  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, q.user_id, COALESCE(v_created_by, q.user_id)
  FROM (
    SELECT cr.user_id
    FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.role IN ('owner','admin')
    UNION
    SELECT ur.user_id
    FROM public.competition_entries ce
    JOIN public.user_roles ur ON ur.team_id = ce.team_id
    WHERE ce.competition_id = _competition_id
      AND ce.status IN ('invited','accepted')
  ) q
  ON CONFLICT DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = gm.user_id
        AND cr.role IN ('owner','admin')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.competition_entries ce
      JOIN public.user_roles ur ON ur.team_id = ce.team_id
      WHERE ce.competition_id = _competition_id
        AND ce.status IN ('invited','accepted')
        AND ur.user_id = gm.user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_competition_member_chat(_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      v_comp.name || ' – All Members',
      NULL, NULL, NULL, v_comp.id, 'all_members',
      ARRAY[]::app_role[], v_comp.created_by, 'manual'
    )
    RETURNING id INTO v_group_id;
  END IF;

  PERFORM public.sync_competition_member_chat_members(_competition_id);

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_competition_member_chat_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_competition_member_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_competition_member_chat_members(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_competition_member_chat(uuid) TO service_role;

-- 5. Triggers
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
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_competition_entry_sync_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id uuid;
BEGIN
  v_comp_id := COALESCE(NEW.competition_id, OLD.competition_id);
  PERFORM public.sync_competition_coord_chat_members(v_comp_id);
  PERFORM public.sync_competition_member_chat_members(v_comp_id);
  IF TG_OP = 'UPDATE' AND NEW.competition_id IS DISTINCT FROM OLD.competition_id THEN
    PERFORM public.sync_competition_coord_chat_members(OLD.competition_id);
    PERFORM public.sync_competition_member_chat_members(OLD.competition_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- team role changes (any role) affect the member chat; team_admin also the coordinator chat
CREATE OR REPLACE FUNCTION public.tg_team_admin_sync_competition_chats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
  v_role app_role;
  r record;
BEGIN
  v_team_id := COALESCE(NEW.team_id, OLD.team_id);
  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_role := COALESCE(NEW.role, OLD.role);

  FOR r IN
    SELECT DISTINCT ce.competition_id
    FROM public.competition_entries ce
    WHERE ce.team_id = v_team_id
  LOOP
    IF v_role = 'team_admin' THEN
      PERFORM public.sync_competition_coord_chat_members(r.competition_id);
    END IF;
    PERFORM public.sync_competition_member_chat_members(r.competition_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- competition rename keeps both thread names in step
CREATE OR REPLACE FUNCTION public.tg_competition_rename_coord_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_groups
       SET name = NEW.name || ' – Coordinators',
           updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'coordinators';

    UPDATE public.chat_groups
       SET name = NEW.name || ' – All Members',
           updated_at = now()
     WHERE competition_id = NEW.id AND competition_scope = 'all_members';
  END IF;
  RETURN NEW;
END;
$$;

-- toggling the member chat creates/hides it
CREATE OR REPLACE FUNCTION public.tg_competition_member_chat_toggle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_chat_enabled IS DISTINCT FROM OLD.member_chat_enabled THEN
    IF NEW.member_chat_enabled THEN
      PERFORM public.ensure_competition_member_chat(NEW.id);
    ELSE
      UPDATE public.chat_groups
         SET deleted_at = now(), updated_at = now()
       WHERE competition_id = NEW.id
         AND competition_scope = 'all_members'
         AND deleted_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_member_chat_toggle ON public.competitions;
CREATE TRIGGER trg_competition_member_chat_toggle
AFTER UPDATE OF member_chat_enabled ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_member_chat_toggle();

-- 6. Posting restriction for organiser-only member chats
CREATE OR REPLACE FUNCTION public.can_post_in_chat_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    JOIN public.competitions c ON c.id = cg.competition_id
    WHERE cg.id = _group_id
      AND cg.competition_scope = 'all_members'
      AND c.member_chat_admins_only
      AND NOT EXISTS (
        SELECT 1 FROM public.competition_roles cr
        WHERE cr.competition_id = c.id
          AND cr.user_id = _user_id
          AND cr.role IN ('owner','admin')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_post_in_chat_group(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Group members can send group messages" ON public.group_messages;
CREATE POLICY "Group members can send group messages"
ON public.group_messages
FOR INSERT
WITH CHECK (
  can_access_chat_group((SELECT auth.uid()), group_id)
  AND author_id = (SELECT auth.uid())
  AND public.can_post_in_chat_group((SELECT auth.uid()), group_id)
);
