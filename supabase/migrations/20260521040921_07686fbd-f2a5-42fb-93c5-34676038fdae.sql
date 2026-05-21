
-- 1. Add competition_id to chat_groups
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_competition_unique
  ON public.chat_groups(competition_id)
  WHERE competition_id IS NOT NULL;

-- 2. Helper: ensure chat group exists for a competition and return its id
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

  SELECT id INTO v_group_id FROM public.chat_groups WHERE competition_id = _competition_id;
  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  INSERT INTO public.chat_groups (
    name, club_id, team_id, mini_league_id, competition_id,
    allowed_roles, created_by, membership_mode
  ) VALUES (
    v_comp.name || ' – Coordinators',
    NULL, NULL, NULL, v_comp.id,
    ARRAY[]::app_role[], v_comp.created_by, 'manual'
  )
  RETURNING id INTO v_group_id;

  -- Seed members from existing coordinator roles (owner/admin)
  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, cr.user_id, v_comp.created_by
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id
    AND cr.role IN ('owner','admin')
  ON CONFLICT DO NOTHING;

  RETURN v_group_id;
END;
$$;

-- 3. Trigger: on competition INSERT, create the chat
CREATE OR REPLACE FUNCTION public.tg_competition_create_coord_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_competition_coord_chat(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_create_coord_chat ON public.competitions;
CREATE TRIGGER trg_competition_create_coord_chat
AFTER INSERT ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_create_coord_chat();

-- 4. Trigger: on competition UPDATE of name, rename chat
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
     WHERE competition_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_rename_coord_chat ON public.competitions;
CREATE TRIGGER trg_competition_rename_coord_chat
AFTER UPDATE OF name ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_rename_coord_chat();

-- 5. Trigger: on competition_roles INSERT/UPDATE/DELETE, sync group membership
CREATE OR REPLACE FUNCTION public.tg_competition_role_sync_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_comp_id uuid;
  v_user_id uuid;
  v_is_coord boolean;
  v_still_coord boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_comp_id := OLD.competition_id;
    v_user_id := OLD.user_id;
  ELSE
    v_comp_id := NEW.competition_id;
    v_user_id := NEW.user_id;
  END IF;

  v_group_id := public.ensure_competition_coord_chat(v_comp_id);
  IF v_group_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Does the user still have any coordinator (owner/admin) role on this competition?
  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles
    WHERE competition_id = v_comp_id
      AND user_id = v_user_id
      AND role IN ('owner','admin')
  ) INTO v_still_coord;

  IF v_still_coord THEN
    INSERT INTO public.group_members (group_id, user_id, added_by)
    VALUES (v_group_id, v_user_id, v_user_id)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.group_members
     WHERE group_id = v_group_id AND user_id = v_user_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_role_sync_chat ON public.competition_roles;
CREATE TRIGGER trg_competition_role_sync_chat
AFTER INSERT OR UPDATE OR DELETE ON public.competition_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_role_sync_chat();

-- 6. Backfill: create chats for existing competitions
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.competitions LOOP
    PERFORM public.ensure_competition_coord_chat(r.id);
  END LOOP;
END $$;
