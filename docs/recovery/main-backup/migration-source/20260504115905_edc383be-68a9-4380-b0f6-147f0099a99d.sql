CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.team_id = _team_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.children c ON c.id = cta.child_id
    WHERE cta.team_id = _team_id
      AND c.parent_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.child_guardians cg ON cg.child_id = cta.child_id
    WHERE cta.team_id = _team_id
      AND cg.guardian_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_member(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.club_id = _club_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE ur.user_id = _user_id
      AND t.club_id = _club_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.children c ON c.id = cta.child_id
    WHERE t.club_id = _club_id
      AND c.parent_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.child_guardians cg ON cg.child_id = cta.child_id
    WHERE t.club_id = _club_id
      AND cg.guardian_id = _user_id
  );
$$;