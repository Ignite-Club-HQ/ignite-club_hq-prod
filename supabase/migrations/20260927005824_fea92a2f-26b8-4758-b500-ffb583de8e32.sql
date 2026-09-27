ALTER TABLE public.chat_groups ADD COLUMN IF NOT EXISTS contact_user_id uuid;

DROP INDEX IF EXISTS public.chat_groups_competition_scope_unique;
CREATE UNIQUE INDEX chat_groups_competition_scope_unique ON public.chat_groups (competition_id, competition_scope)
  WHERE competition_id IS NOT NULL AND contact_user_id IS NULL;
CREATE UNIQUE INDEX chat_groups_competition_contact_unique ON public.chat_groups (competition_id, contact_user_id)
  WHERE competition_id IS NOT NULL AND contact_user_id IS NOT NULL;

-- Only the sync routine may change membership of admin-contact threads.
CREATE OR REPLACE FUNCTION public.guard_competition_contact_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gid uuid := COALESCE(NEW.group_id, OLD.group_id);
BEGIN
  IF current_setting('ignite.comp_contact_sync', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF EXISTS (SELECT 1 FROM chat_groups WHERE id = v_gid AND competition_scope = 'admin_contact') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD; -- leaving is allowed; admins are re-added on next sync
    END IF;
    RAISE EXCEPTION 'Members of this chat are managed automatically';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_competition_contact_members ON public.group_members;
CREATE TRIGGER trg_guard_competition_contact_members
  BEFORE INSERT OR UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_competition_contact_members();

CREATE OR REPLACE FUNCTION public.sync_competition_contact_chat_members(_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  SELECT id, competition_id, contact_user_id INTO g FROM chat_groups
   WHERE id = _group_id AND competition_scope = 'admin_contact';
  IF g.id IS NULL THEN RETURN; END IF;
  PERFORM set_config('ignite.comp_contact_sync', 'on', true);

  INSERT INTO group_members (group_id, user_id, added_by)
  SELECT g.id, u, g.contact_user_id FROM (
    SELECT g.contact_user_id AS u
    UNION
    SELECT cr.user_id FROM competition_roles cr
     WHERE cr.competition_id = g.competition_id AND cr.role IN ('owner','admin')
  ) s
  ON CONFLICT (group_id, user_id) DO NOTHING;

  DELETE FROM group_members gm
   WHERE gm.group_id = g.id
     AND gm.user_id <> g.contact_user_id
     AND NOT EXISTS (SELECT 1 FROM competition_roles cr
       WHERE cr.competition_id = g.competition_id AND cr.user_id = gm.user_id AND cr.role IN ('owner','admin'));

  PERFORM set_config('ignite.comp_contact_sync', 'off', true);
END $$;

CREATE OR REPLACE FUNCTION public.can_contact_competition_admins(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_competition_role_admin(_user_id, _competition_id) AND (
    EXISTS (SELECT 1 FROM competition_roles WHERE competition_id = _competition_id
            AND user_id = _user_id AND role IN ('referee','committee','scorer'))
    OR EXISTS (SELECT 1 FROM competition_entries ce JOIN user_roles ur ON ur.team_id = ce.team_id
            WHERE ce.competition_id = _competition_id AND ce.status IN ('invited','accepted')
              AND ur.user_id = _user_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_competition_admin_chat(p_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_comp record; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT id INTO v_id FROM chat_groups
   WHERE competition_id = p_competition_id AND contact_user_id = v_uid AND competition_scope = 'admin_contact';
  IF v_id IS NULL THEN
    IF public.is_competition_role_admin(v_uid, p_competition_id) THEN
      RAISE EXCEPTION 'You are an admin of this competition';
    END IF;
    IF NOT public.can_contact_competition_admins(v_uid, p_competition_id) THEN
      RAISE EXCEPTION 'You are not part of this competition';
    END IF;
    SELECT id, name, created_by INTO v_comp FROM competitions WHERE id = p_competition_id;
    IF v_comp.id IS NULL THEN RAISE EXCEPTION 'Competition not found'; END IF;
    SELECT display_name INTO v_name FROM profiles WHERE id = v_uid;
    INSERT INTO chat_groups (name, club_id, team_id, mini_league_id, competition_id, competition_scope,
      contact_user_id, allowed_roles, created_by, membership_mode, allow_forwarding)
    VALUES (COALESCE(v_name, 'Member') || ' · ' || v_comp.name || ' admins', NULL, NULL, NULL,
      v_comp.id, 'admin_contact', v_uid, ARRAY[]::app_role[], COALESCE(v_comp.created_by, v_uid), 'manual', false)
    RETURNING id INTO v_id;
  ELSE
    UPDATE chat_groups SET deleted_at = NULL WHERE id = v_id AND deleted_at IS NOT NULL;
  END IF;
  PERFORM public.sync_competition_contact_chat_members(v_id);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_competition_admin_chat(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_competition_admin_chat(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_competition_contact_chat_members(uuid) FROM public, anon, authenticated;

-- Competitions the caller can contact, optionally scoped to a club (organiser or a club with the caller's entered team).
CREATE OR REPLACE FUNCTION public.list_contactable_competitions(p_club_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, logo_url text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.logo_url FROM competitions c
  WHERE c.status = 'active'
    AND (c.ends_on IS NULL OR c.ends_on >= current_date - 14)
    AND public.can_contact_competition_admins(auth.uid(), c.id)
    AND (p_club_id IS NULL OR c.organizer_club_id = p_club_id OR EXISTS (
      SELECT 1 FROM competition_entries ce JOIN teams t ON t.id = ce.team_id
      JOIN user_roles ur ON ur.team_id = ce.team_id AND ur.user_id = auth.uid()
      WHERE ce.competition_id = c.id AND ce.status IN ('invited','accepted') AND t.club_id = p_club_id)
    OR EXISTS (SELECT 1 FROM competition_roles cr WHERE cr.competition_id = c.id AND cr.user_id = auth.uid()
      AND EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = auth.uid() AND ur2.club_id = p_club_id)
      AND c.organizer_club_id = p_club_id))
  ORDER BY c.name
$$;
REVOKE ALL ON FUNCTION public.list_contactable_competitions(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_contactable_competitions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_competition_role_sync_contact_chats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM chat_groups WHERE competition_id = COALESCE(NEW.competition_id, OLD.competition_id)
           AND competition_scope = 'admin_contact' LOOP
    PERFORM public.sync_competition_contact_chat_members(r.id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_competition_role_sync_contact_chats ON public.competition_roles;
CREATE TRIGGER trg_competition_role_sync_contact_chats
  AFTER INSERT OR UPDATE OR DELETE ON public.competition_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_role_sync_contact_chats();