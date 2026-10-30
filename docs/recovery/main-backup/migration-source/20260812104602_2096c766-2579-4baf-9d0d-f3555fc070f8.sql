-- Membership rule for competition coordinator chats:
--   competition_roles(owner|admin)  UNION  team_admin of teams with a competition entry
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
  SELECT id FROM public.chat_groups WHERE competition_id = _competition_id INTO v_group_id;
  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT created_by INTO v_created_by FROM public.competitions WHERE id = _competition_id;

  -- Add anyone who qualifies
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

  -- Remove anyone who no longer qualifies
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

REVOKE ALL ON FUNCTION public.sync_competition_coord_chat_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_competition_coord_chat_members(uuid) TO service_role;

-- Seed new coordinator chats using the same rule
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

  PERFORM public.sync_competition_coord_chat_members(_competition_id);

  RETURN v_group_id;
END;
$$;

-- Coordinator role changes: reuse the single membership rule
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
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Team entries added/removed from a competition
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
  IF TG_OP = 'UPDATE' AND NEW.competition_id IS DISTINCT FROM OLD.competition_id THEN
    PERFORM public.sync_competition_coord_chat_members(OLD.competition_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_entry_sync_chat ON public.competition_entries;
CREATE TRIGGER trg_competition_entry_sync_chat
AFTER INSERT OR UPDATE OR DELETE ON public.competition_entries
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_entry_sync_chat();

-- team_admin role grants/revocations affect coordinator chat membership
CREATE OR REPLACE FUNCTION public.tg_team_admin_sync_competition_chats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
  r record;
BEGIN
  v_team_id := COALESCE(NEW.team_id, OLD.team_id);
  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(NEW.role, OLD.role) <> 'team_admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR r IN
    SELECT DISTINCT ce.competition_id
    FROM public.competition_entries ce
    WHERE ce.team_id = v_team_id
  LOOP
    PERFORM public.sync_competition_coord_chat_members(r.competition_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_team_admin_sync_competition_chats ON public.user_roles;
CREATE TRIGGER trg_team_admin_sync_competition_chats
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_team_admin_sync_competition_chats();

-- Backfill existing competition coordinator chats
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT competition_id FROM public.chat_groups WHERE competition_id IS NOT NULL LOOP
    PERFORM public.sync_competition_coord_chat_members(r.competition_id);
  END LOOP;
END $$;