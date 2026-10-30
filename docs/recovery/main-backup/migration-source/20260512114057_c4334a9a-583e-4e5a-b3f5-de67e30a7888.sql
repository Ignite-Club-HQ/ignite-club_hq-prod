-- Allow per-league admins to create/manage pending_invites that belong to a mini-league they administer.
-- The invite is identified by metadata->>'mini_league_id'.
-- Existing club_admin policy already covers club-wide league admins via club role; this adds the per-league grant path.

CREATE POLICY "League admins can manage league pending invites"
ON public.pending_invites
FOR ALL
TO authenticated
USING (
  (metadata ? 'mini_league_id')
  AND public.is_league_admin(auth.uid(), (metadata->>'mini_league_id')::uuid)
)
WITH CHECK (
  (metadata ? 'mini_league_id')
  AND public.is_league_admin(auth.uid(), (metadata->>'mini_league_id')::uuid)
  AND invited_by_user_id = auth.uid()
);