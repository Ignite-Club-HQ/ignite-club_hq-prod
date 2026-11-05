CREATE OR REPLACE FUNCTION public.link_existing_child_as_guardian(
  p_child_id uuid,
  p_relationship text DEFAULT 'parent'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_shares boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_child_id IS NULL THEN
    RAISE EXCEPTION 'Child id is required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.user_roles ur ON (ur.club_id = t.club_id OR ur.team_id = t.id)
    WHERE cta.child_id = p_child_id
      AND ur.user_id = v_caller
  ) INTO v_shares;

  IF NOT v_shares THEN
    RAISE EXCEPTION 'Access denied: child is not in one of your clubs or teams';
  END IF;

  INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
  VALUES (p_child_id, v_caller, coalesce(nullif(btrim(coalesce(p_relationship, '')), ''), 'parent'), false)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('status', 'linked', 'child_id', p_child_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.link_existing_child_as_guardian(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_existing_child_as_guardian(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_existing_child_as_guardian(uuid, text) TO service_role;