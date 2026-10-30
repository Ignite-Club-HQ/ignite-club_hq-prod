CREATE OR REPLACE FUNCTION public._can_add_player_to_team(p_team_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_club uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT club_id INTO v_club FROM public.teams WHERE id = p_team_id AND deleted_at IS NULL;
  IF v_club IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND (
      (ur.team_id = p_team_id AND ur.role IN ('team_admin','coach','app_admin'))
      OR (ur.club_id = v_club AND ur.role IN ('club_admin','committee_member','app_admin')))) THEN
    RETURN v_club;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._can_add_player_to_team(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_club_children_for_team(p_team_id uuid, p_query text)
RETURNS TABLE(child_id uuid, name text, year_of_birth integer, team_names text[], guardian_names text[], on_this_team boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_club uuid; v_q text;
BEGIN
  v_club := public._can_add_player_to_team(p_team_id);
  IF v_club IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  v_q := btrim(coalesce(p_query, ''));
  IF length(v_q) < 2 THEN RETURN; END IF;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  RETURN QUERY
  WITH club_kids AS (
    SELECT DISTINCT c.id, c.name, c.year_of_birth, c.parent_id
    FROM public.children c
    JOIN public.child_team_assignments cta ON cta.child_id = c.id
    JOIN public.teams t ON t.id = cta.team_id AND t.club_id = v_club AND t.deleted_at IS NULL
    WHERE c.name ILIKE '%' || v_q || '%'
    LIMIT 25
  )
  SELECT k.id, k.name, k.year_of_birth,
    coalesce((SELECT array_agg(DISTINCT t.name ORDER BY t.name) FROM public.child_team_assignments a
              JOIN public.teams t ON t.id = a.team_id AND t.club_id = v_club AND t.deleted_at IS NULL
              WHERE a.child_id = k.id), '{}'),
    coalesce((SELECT array_agg(DISTINCT p.display_name) FROM public.profiles p
              WHERE p.display_name IS NOT NULL AND public.is_guardian_visible_in_club(p.id, v_club)
                AND (p.id = k.parent_id OR EXISTS (SELECT 1 FROM public.child_guardians g WHERE g.child_id = k.id AND g.guardian_id = p.id))), '{}'),
    EXISTS (SELECT 1 FROM public.child_team_assignments a WHERE a.child_id = k.id AND a.team_id = p_team_id)
  FROM club_kids k
  ORDER BY k.name;
END $$;
REVOKE ALL ON FUNCTION public.search_club_children_for_team(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_club_children_for_team(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_existing_club_child_to_team(p_team_id uuid, p_child_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_club uuid;
BEGIN
  v_club := public._can_add_player_to_team(p_team_id);
  IF v_club IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.child_team_assignments a JOIN public.teams t ON t.id = a.team_id
                 WHERE a.child_id = p_child_id AND t.club_id = v_club AND t.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Player is not in this club' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.child_team_assignments WHERE child_id = p_child_id AND team_id = p_team_id) THEN
    RAISE EXCEPTION 'This player is already on this team';
  END IF;
  INSERT INTO public.child_team_assignments (child_id, team_id) VALUES (p_child_id, p_team_id);
  RETURN p_child_id;
END $$;
REVOKE ALL ON FUNCTION public.add_existing_club_child_to_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_existing_club_child_to_team(uuid, uuid) TO authenticated;