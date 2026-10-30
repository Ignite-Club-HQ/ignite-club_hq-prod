CREATE OR REPLACE FUNCTION public.sync_competition_contact_chat_members(_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE g record; v_eligible boolean;
BEGIN
  SELECT id, competition_id, contact_user_id INTO g FROM chat_groups
   WHERE id = _group_id AND competition_scope = 'admin_contact';
  IF g.id IS NULL THEN RETURN; END IF;
  v_eligible := public.can_contact_competition_admins(g.contact_user_id, g.competition_id)
             OR public.is_competition_role_admin(g.contact_user_id, g.competition_id);
  PERFORM set_config('ignite.comp_contact_sync', 'on', true);

  INSERT INTO group_members (group_id, user_id, added_by)
  SELECT g.id, u, g.contact_user_id FROM (
    SELECT g.contact_user_id AS u WHERE v_eligible
    UNION
    SELECT cr.user_id FROM competition_roles cr
     WHERE cr.competition_id = g.competition_id AND cr.role IN ('owner','admin')
  ) s
  ON CONFLICT (group_id, user_id) DO NOTHING;

  DELETE FROM group_members gm
   WHERE gm.group_id = g.id
     AND (gm.user_id <> g.contact_user_id OR NOT v_eligible)
     AND NOT EXISTS (SELECT 1 FROM competition_roles cr
       WHERE cr.competition_id = g.competition_id AND cr.user_id = gm.user_id AND cr.role IN ('owner','admin'));

  PERFORM set_config('ignite.comp_contact_sync', 'off', true);
END $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_competition_admin_chat(p_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_comp record; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.is_competition_role_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'You are an admin of this competition';
  END IF;
  IF NOT public.can_contact_competition_admins(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'You are not part of this competition';
  END IF;
  SELECT id INTO v_id FROM chat_groups
   WHERE competition_id = p_competition_id AND contact_user_id = v_uid AND competition_scope = 'admin_contact';
  IF v_id IS NULL THEN
    SELECT id, name, created_by INTO v_comp FROM competitions WHERE id = p_competition_id;
    IF v_comp.id IS NULL THEN RAISE EXCEPTION 'Competition not found'; END IF;
    SELECT display_name INTO v_name FROM profiles WHERE id = v_uid;
    PERFORM set_config('ignite.comp_contact_sync', 'on', true);
    INSERT INTO chat_groups (name, club_id, team_id, mini_league_id, competition_id, competition_scope,
      contact_user_id, allowed_roles, created_by, membership_mode, allow_forwarding)
    VALUES (COALESCE(v_name, 'Member') || ' · ' || v_comp.name || ' admins', NULL, NULL, NULL,
      v_comp.id, 'admin_contact', v_uid, ARRAY[]::app_role[], COALESCE(v_comp.created_by, v_uid), 'manual', false)
    RETURNING id INTO v_id;
    PERFORM set_config('ignite.comp_contact_sync', 'off', true);
  ELSE
    UPDATE chat_groups SET deleted_at = NULL WHERE id = v_id AND deleted_at IS NOT NULL;
  END IF;
  PERFORM public.sync_competition_contact_chat_members(v_id);
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_user_roles_sync_contact_chats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record;
BEGIN
  IF COALESCE(NEW.team_id, OLD.team_id) IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  FOR r IN SELECT cg.id FROM chat_groups cg
    WHERE cg.competition_scope = 'admin_contact'
      AND cg.contact_user_id IN (COALESCE(NEW.user_id, OLD.user_id), COALESCE(OLD.user_id, NEW.user_id)) LOOP
    PERFORM public.sync_competition_contact_chat_members(r.id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_user_roles_sync_contact_chats ON public.user_roles;
CREATE TRIGGER trg_user_roles_sync_contact_chats
AFTER INSERT OR DELETE OR UPDATE OF team_id, user_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_sync_contact_chats();

CREATE OR REPLACE FUNCTION public.tg_competition_entries_sync_contact_chats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM chat_groups WHERE competition_id = COALESCE(NEW.competition_id, OLD.competition_id)
           AND competition_scope = 'admin_contact' LOOP
    PERFORM public.sync_competition_contact_chat_members(r.id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_competition_entries_sync_contact_chats ON public.competition_entries;
CREATE TRIGGER trg_competition_entries_sync_contact_chats
AFTER INSERT OR DELETE OR UPDATE OF status, team_id ON public.competition_entries
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_entries_sync_contact_chats();