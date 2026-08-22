-- Widen competition ownership eligibility: owning a competition is a
-- competition-scoped responsibility, not a club-wide league role.
--
-- The single-owner rule, the demote-on-transfer behaviour and who may WRITE
-- competition_roles rows (RLS via is_competition_admin) are unchanged. Only
-- the eligibility check for who may RECEIVE 'owner' is widened.

-- Helper: is user eligible to receive ownership of the competition
CREATE OR REPLACE FUNCTION public.is_eligible_competition_owner(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- app_admin (any scope)
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'app_admin'
  ) OR EXISTS (
    -- club_admin or league_admin at the competition's organising club
    -- (league_admin keeps its historical global scope: club_id IS NULL counts)
    SELECT 1
    FROM public.competitions c
    JOIN public.user_roles ur
      ON ur.user_id = _user_id
     AND ur.role IN ('club_admin', 'league_admin')
     AND (ur.club_id = c.organizer_club_id OR (ur.role = 'league_admin' AND ur.club_id IS NULL))
    WHERE c.id = _competition_id
  ) OR EXISTS (
    -- already an admin/owner of this competition
    SELECT 1
    FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.user_id = _user_id
      AND cr.role IN ('admin', 'owner')
  );
$$;

-- Enforce: owner must be eligible, otherwise transfer to one
-- (name and signature unchanged so all existing triggers keep working)
CREATE OR REPLACE FUNCTION public.enforce_competition_owner_is_league_admin(_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_new_owner uuid;
  v_club uuid;
BEGIN
  SELECT organizer_club_id INTO v_club FROM public.competitions WHERE id = _competition_id;
  IF v_club IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_owner
  FROM public.competition_roles
  WHERE competition_id = _competition_id AND role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  IF v_owner IS NOT NULL AND public.is_eligible_competition_owner(v_owner, _competition_id) THEN
    RETURN v_owner;
  END IF;

  -- Prefer an existing competition admin who is eligible, else any club/league admin of the club
  SELECT cr.user_id INTO v_new_owner
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id
    AND cr.role IN ('admin','owner')
    AND cr.user_id IS DISTINCT FROM v_owner
    AND public.is_eligible_competition_owner(cr.user_id, _competition_id)
  ORDER BY cr.created_at
  LIMIT 1;

  IF v_new_owner IS NULL THEN
    SELECT ur.user_id INTO v_new_owner
    FROM public.user_roles ur
    WHERE ur.role IN ('club_admin','league_admin')
      AND ur.club_id = v_club
      AND ur.user_id IS DISTINCT FROM v_owner
    ORDER BY ur.created_at
    LIMIT 1;
  END IF;

  IF v_new_owner IS NULL THEN
    -- No eligible owner candidate: leave ownership untouched
    RETURN v_owner;
  END IF;

  -- Demote current owner to admin (keep access), promote new owner
  IF v_owner IS NOT NULL THEN
    UPDATE public.competition_roles
    SET role = 'admin'
    WHERE competition_id = _competition_id AND user_id = v_owner AND role = 'owner';
  END IF;

  DELETE FROM public.competition_roles
  WHERE competition_id = _competition_id AND user_id = v_new_owner;

  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (_competition_id, v_new_owner, 'owner')
  ON CONFLICT DO NOTHING;

  PERFORM public.sync_competition_coord_chat_members(_competition_id);

  RETURN v_new_owner;
END;
$$;