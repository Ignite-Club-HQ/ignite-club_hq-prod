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
    -- The creator auto-add trigger fires here; sync below removes them unless they are an owner/admin.
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
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_competition_admin_chat(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_competition_admin_chat(uuid) TO authenticated;