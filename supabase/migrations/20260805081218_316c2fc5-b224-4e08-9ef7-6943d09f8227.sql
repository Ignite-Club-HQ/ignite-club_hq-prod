CREATE OR REPLACE FUNCTION public.upsert_child_for_guardian(
  p_name text,
  p_year_of_birth integer DEFAULT NULL,
  p_guardian_user_id uuid DEFAULT NULL,
  p_relationship text DEFAULT 'parent',
  p_club_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_guardian uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_child_id uuid;
  v_match_count integer := 0;
  v_matches jsonb;
  v_rel text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_guardian := coalesce(p_guardian_user_id, v_caller);
  v_rel := coalesce(nullif(btrim(coalesce(p_relationship, '')), ''), 'parent');

  IF v_guardian <> v_caller AND NOT public.has_role(v_caller, 'app_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Child name is required';
  END IF;

  -- Already the guardian's own child? Reuse it, never duplicate.
  SELECT c.id INTO v_child_id
  FROM public.children c
  WHERE lower(btrim(c.name)) = lower(v_name)
    AND coalesce(c.year_of_birth, -1) = coalesce(p_year_of_birth, -1)
    AND (
      c.parent_id = v_guardian
      OR EXISTS (
        SELECT 1 FROM public.child_guardians g
        WHERE g.child_id = c.id AND g.guardian_id = v_guardian
      )
    )
  ORDER BY c.created_at
  LIMIT 1;

  IF v_child_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'existing', 'child_id', v_child_id);
  END IF;

  -- Candidate matches, computed inline (no temp table): same name + birth year,
  -- already guardian-linked, and rostered in a club/team the guardian shares.
  WITH matches AS (
    SELECT DISTINCT c.id AS child_id, c.name, c.year_of_birth
    FROM public.children c
    WHERE lower(btrim(c.name)) = lower(v_name)
      AND coalesce(c.year_of_birth, -1) = coalesce(p_year_of_birth, -1)
      AND EXISTS (SELECT 1 FROM public.child_guardians g WHERE g.child_id = c.id)
      AND EXISTS (
        SELECT 1
        FROM public.child_team_assignments cta
        JOIN public.teams t ON t.id = cta.team_id
        WHERE cta.child_id = c.id
          AND (
            (p_club_id IS NOT NULL AND t.club_id = p_club_id)
            OR (
              p_club_id IS NULL AND EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = v_guardian
                  AND (ur.club_id = t.club_id OR ur.team_id = t.id)
              )
            )
          )
      )
  )
  SELECT count(*)::int,
         jsonb_agg(jsonb_build_object('child_id', m.child_id, 'name', m.name, 'year_of_birth', m.year_of_birth)),
         (SELECT m2.child_id FROM matches m2 LIMIT 1)
    INTO v_match_count, v_matches, v_child_id
  FROM matches m;

  IF v_match_count > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous', 'matches', coalesce(v_matches, '[]'::jsonb));
  END IF;

  IF v_match_count = 1 AND v_child_id IS NOT NULL THEN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_child_id, v_guardian, v_rel, false)
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object('status', 'linked', 'child_id', v_child_id);
  END IF;

  INSERT INTO public.children (name, year_of_birth, parent_id)
  VALUES (v_name, p_year_of_birth, v_guardian)
  RETURNING id INTO v_child_id;

  INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
  VALUES (v_child_id, v_guardian, v_rel, true)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('status', 'created', 'child_id', v_child_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_child_for_guardian(text, integer, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_child_for_guardian(text, integer, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_child_for_guardian(text, integer, uuid, text, uuid) TO service_role;

-- Orphan audit: ignore the creating parent's own guardian link, otherwise every
-- child created through the new RPC is permanently invisible to the audit.
CREATE OR REPLACE FUNCTION public.audit_orphan_children()
RETURNS TABLE (child_id uuid, name text, year_of_birth integer, parent_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.name, c.year_of_birth, c.parent_id, c.created_at
  FROM public.children c
  WHERE c.created_at < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.child_team_assignments a WHERE a.child_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.child_guardians g
      WHERE g.child_id = c.id
        AND (c.parent_id IS NULL OR g.guardian_id <> c.parent_id)
    )
    AND (
      public.has_role(auth.uid(), 'app_admin')
      OR auth.role() = 'service_role'
    )
  ORDER BY c.created_at;
$function$;

REVOKE ALL ON FUNCTION public.audit_orphan_children() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_orphan_children() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_orphan_children() TO service_role;