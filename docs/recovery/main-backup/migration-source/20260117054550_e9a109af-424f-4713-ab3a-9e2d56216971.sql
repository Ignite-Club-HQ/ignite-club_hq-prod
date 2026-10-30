-- Create RPC function to get pending invite details by token (bypasses RLS for token-based lookup)
CREATE OR REPLACE FUNCTION public.get_pending_invite_by_token(_token text)
RETURNS TABLE (
  id uuid,
  team_id uuid,
  club_id uuid,
  role text,
  invited_label text,
  invited_email text,
  status text,
  team_name text,
  team_logo_url text,
  club_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pi.id,
    pi.team_id,
    pi.club_id,
    pi.role::text,
    pi.invited_label,
    pi.invited_email,
    pi.status,
    t.name as team_name,
    t.logo_url as team_logo_url,
    c.name as club_name
  FROM pending_invites pi
  LEFT JOIN teams t ON t.id = pi.team_id
  LEFT JOIN clubs c ON c.id = COALESCE(pi.club_id, t.club_id)
  WHERE pi.invite_token = _token;
END;
$$;