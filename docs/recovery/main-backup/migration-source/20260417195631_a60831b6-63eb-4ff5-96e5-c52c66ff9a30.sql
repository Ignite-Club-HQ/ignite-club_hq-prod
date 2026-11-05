
-- Track invite + confirmation
ALTER TABLE public.eoi_submissions
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS extra_notes text;

-- Helper: is the current user an admin of this club?
CREATE OR REPLACE FUNCTION public.is_club_admin_for(_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'club_admin' AND ur.club_id = _club_id)
        OR ur.role = 'app_admin'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_club_admin_for(uuid) TO authenticated;

-- RPC: suggest draft team allocations
CREATE OR REPLACE FUNCTION public.suggest_eoi_teams(_season_id uuid)
RETURNS TABLE (
  age_group text,
  player_count bigint,
  avg_skill numeric,
  submission_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id FROM public.seasons WHERE id = _season_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;
  IF NOT public.is_club_admin_for(v_club_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(e.age_group, 'Unknown') AS age_group,
    COUNT(*)::bigint AS player_count,
    ROUND(AVG(COALESCE(e.skill_level, 3))::numeric, 2) AS avg_skill,
    ARRAY_AGG(e.id ORDER BY e.skill_level DESC NULLS LAST, e.submitted_at) AS submission_ids
  FROM public.eoi_submissions e
  WHERE e.season_id = _season_id
    AND e.status IN ('submitted','preferences_completed')
    AND e.assigned_team_id IS NULL
  GROUP BY COALESCE(e.age_group, 'Unknown')
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_eoi_teams(uuid) TO authenticated;

-- RPC: allocate a submission to a team
CREATE OR REPLACE FUNCTION public.allocate_eoi_to_team(_submission_id uuid, _team_id uuid)
RETURNS public.eoi_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.eoi_submissions;
  v_team_club uuid;
BEGIN
  SELECT * INTO v_sub FROM public.eoi_submissions WHERE id = _submission_id;
  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF NOT public.is_club_admin_for(v_sub.club_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _team_id IS NOT NULL THEN
    SELECT club_id INTO v_team_club FROM public.teams WHERE id = _team_id;
    IF v_team_club IS NULL OR v_team_club <> v_sub.club_id THEN
      RAISE EXCEPTION 'Team must belong to the same club';
    END IF;
  END IF;

  UPDATE public.eoi_submissions
     SET assigned_team_id = _team_id,
         status = CASE WHEN _team_id IS NULL THEN 'submitted'::eoi_status ELSE 'allocated'::eoi_status END,
         allocated_at = CASE WHEN _team_id IS NULL THEN NULL ELSE now() END
   WHERE id = _submission_id
  RETURNING * INTO v_sub;

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_eoi_to_team(uuid, uuid) TO authenticated;

-- RPC: confirm placement (called by parent)
CREATE OR REPLACE FUNCTION public.confirm_eoi_placement(_submission_id uuid)
RETURNS public.eoi_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.eoi_submissions;
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  UPDATE public.eoi_submissions
     SET status = 'confirmed'::eoi_status,
         confirmed_at = COALESCE(confirmed_at, now()),
         parent_confirmed_at = now(),
         parent_user_id = COALESCE(parent_user_id, v_uid)
   WHERE id = _submission_id
     AND (parent_user_id = v_uid OR lower(parent_email) = lower(v_email))
  RETURNING * INTO v_sub;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found or not yours';
  END IF;
  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_eoi_placement(uuid) TO authenticated;

-- RPC: list my pending EOIs
CREATE OR REPLACE FUNCTION public.get_my_pending_eois()
RETURNS SETOF public.eoi_submissions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  RETURN QUERY
    SELECT * FROM public.eoi_submissions
     WHERE (parent_user_id = v_uid OR lower(parent_email) = lower(COALESCE(v_email, '')))
       AND status NOT IN ('registered','withdrawn')
     ORDER BY submitted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_eois() TO authenticated;
