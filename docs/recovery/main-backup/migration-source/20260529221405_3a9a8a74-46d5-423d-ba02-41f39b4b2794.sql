-- Fix: team-join-link parents can't insert their user_roles row because the
-- inline EXISTS on team_invites inside the user_roles INSERT policy runs under
-- the caller's RLS context, and team_invites SELECT is admin-only.
-- Replace the raw subquery with a SECURITY DEFINER helper that bypasses RLS.

CREATE OR REPLACE FUNCTION public.has_valid_team_invite_for_role(_team_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_invites ti
    WHERE ti.team_id = _team_id
      AND ti.role = _role
      AND (ti.expires_at IS NULL OR ti.expires_at > now())
      AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_valid_team_invite_for_role(uuid, app_role) TO authenticated;

DROP POLICY IF EXISTS "Users can add roles via valid team invite" ON public.user_roles;

CREATE POLICY "Users can add roles via valid team invite"
ON public.user_roles
FOR INSERT
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND team_id IS NOT NULL
  AND (
    public.has_valid_team_invite_for_role(team_id, role)
    OR EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = (SELECT auth.uid())
        AND pi.status = 'pending'
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_email IS NOT NULL
        AND public.user_email_matches_invite((SELECT auth.uid()), pi.invited_email)
        AND pi.status = 'pending'
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = (SELECT auth.uid())
        AND pi.status = 'accepted'
        AND pi.accepted_at > (now() - interval '2 minutes')
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_email IS NOT NULL
        AND public.user_email_matches_invite((SELECT auth.uid()), pi.invited_email)
        AND pi.status = 'accepted'
        AND pi.accepted_at > (now() - interval '2 minutes')
    )
  )
);