
DROP FUNCTION IF EXISTS public.get_team_invite_by_token(text);

CREATE FUNCTION public.get_team_invite_by_token(_token text)
RETURNS TABLE(
  id uuid, team_id uuid, role text, token text, uses_count int, max_uses int,
  expires_at timestamptz, created_at timestamptz, created_by uuid,
  team_name text, team_logo_url text, club_id uuid, club_name text,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ti.id, ti.team_id, ti.role::text, ti.token, ti.uses_count, ti.max_uses,
    ti.expires_at, ti.created_at, ti.created_by,
    t.name as team_name, t.logo_url as team_logo_url,
    t.club_id, c.name as club_name,
    ti.metadata
  FROM public.team_invites ti
  JOIN public.teams t ON t.id = ti.team_id
  LEFT JOIN public.clubs c ON c.id = t.club_id
  WHERE ti.token = _token
  LIMIT 1;
$$;
