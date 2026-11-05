
-- Fix 1: Restrict admob_config SELECT to app admins only
DROP POLICY IF EXISTS "Anyone can view admob config" ON public.admob_config;
DROP POLICY IF EXISTS "Authenticated users can view admob config" ON public.admob_config;
DROP POLICY IF EXISTS "Public can read admob config" ON public.admob_config;

-- Create restrictive policy: only app admins can read admob config
CREATE POLICY "Only app admins can view admob config"
ON public.admob_config
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'app_admin'));

-- Fix 2: Restrict team_invites SELECT to token-based lookup via security definer function
-- The existing get_team_invite_by_token function already provides secure token lookup
-- We just need to restrict direct table access
DROP POLICY IF EXISTS "Anyone can read valid team invites" ON public.team_invites;
DROP POLICY IF EXISTS "Anyone can view team invites" ON public.team_invites;

-- Only allow team/club admins to browse invites, or the invite creator
CREATE POLICY "Admins and creators can view team invites"
ON public.team_invites
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.teams t ON t.id = team_invites.team_id
    WHERE ur.user_id = auth.uid()
    AND (
      (ur.role = 'app_admin')
      OR (ur.role = 'club_admin' AND ur.club_id = t.club_id)
      OR (ur.role = 'team_admin' AND ur.team_id = team_invites.team_id)
    )
  )
);
