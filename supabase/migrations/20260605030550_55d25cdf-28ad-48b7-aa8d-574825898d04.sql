-- RPC to search candidate coordinators for a competition.
-- Returns users who hold an admin-ish role in the organizer club or its parent association.
-- Caller must be a competition admin.
CREATE OR REPLACE FUNCTION public.search_competition_coordinator_candidates(
  _competition_id uuid,
  _query text DEFAULT ''
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _organizer_club_id uuid;
  _parent_org_id uuid;
  _q text;
BEGIN
  IF NOT public.is_competition_admin(auth.uid(), _competition_id) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  SELECT c.organizer_club_id, cl.parent_org_id
    INTO _organizer_club_id, _parent_org_id
  FROM public.competitions c
  LEFT JOIN public.clubs cl ON cl.id = c.organizer_club_id
  WHERE c.id = _competition_id;

  _q := NULLIF(btrim(_query), '');

  RETURN QUERY
  WITH candidates AS (
    SELECT ur.user_id,
           CASE WHEN ur.club_id = _organizer_club_id THEN 'club'
                WHEN ur.club_id = _parent_org_id THEN 'association'
                ELSE 'other' END AS source,
           ur.role::text AS role_text
    FROM public.user_roles ur
    WHERE ur.role IN ('club_admin','committee_member','association_admin')
      AND (
        (_organizer_club_id IS NOT NULL AND ur.club_id = _organizer_club_id)
        OR (_parent_org_id IS NOT NULL AND ur.club_id = _parent_org_id)
      )
  )
  SELECT DISTINCT ON (p.id)
    p.id AS user_id,
    p.display_name,
    p.avatar_url,
    c.source
  FROM candidates c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE (_q IS NULL OR p.display_name ILIKE '%' || _q || '%')
  ORDER BY p.id, c.source
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_competition_coordinator_candidates(uuid, text) TO authenticated;

-- Companion RPC: list current coordinators with profile info (so we don't need profile-table read access).
CREATE OR REPLACE FUNCTION public.list_competition_coordinators(_competition_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  display_name text,
  avatar_url text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_competition(auth.uid(), _competition_id) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
  SELECT cr.user_id, cr.role::text, p.display_name, p.avatar_url, cr.created_at
  FROM public.competition_roles cr
  LEFT JOIN public.profiles p ON p.id = cr.user_id
  WHERE cr.competition_id = _competition_id
  ORDER BY (cr.role::text = 'owner') DESC, p.display_name NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_competition_coordinators(uuid) TO authenticated;