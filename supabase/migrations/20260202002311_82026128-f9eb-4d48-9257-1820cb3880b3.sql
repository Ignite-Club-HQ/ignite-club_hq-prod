-- Fix RLS policy for team role inserts via pending invites
-- The issue: invite is marked 'accepted' before role insert, but RLS checks for 'pending' status
-- OR requires invited_user_id match within 2 minutes of acceptance

-- Drop and recreate the policy to also check by email match for recently accepted invites
DROP POLICY IF EXISTS "Users can add roles via valid team invite" ON public.user_roles;

CREATE POLICY "Users can add roles via valid team invite"
ON public.user_roles
FOR INSERT
WITH CHECK (
  user_id = auth.uid() 
  AND team_id IS NOT NULL 
  AND (
    -- Via team_invites link (public invite links)
    EXISTS (
      SELECT 1 FROM team_invites ti
      WHERE ti.team_id = user_roles.team_id
        AND ti.role = user_roles.role
        AND (ti.expires_at IS NULL OR ti.expires_at > now())
        AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
    )
    -- Allow any selectable role when a team invite exists for the team
    OR (
      user_roles.role IN ('coach', 'player', 'parent')
      AND EXISTS (
        SELECT 1 FROM team_invites ti
        WHERE ti.team_id = user_roles.team_id
          AND (ti.expires_at IS NULL OR ti.expires_at > now())
          AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
      )
    )
    -- Via pending_invites with user_id match (status = pending)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    -- Via pending_invites with email match (status = pending)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_email IS NOT NULL
        AND user_email_matches_invite(auth.uid(), pi.invited_email)
        AND pi.status = 'pending'
    )
    -- Via pending_invites recently accepted (by user_id) - 2 min grace period
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
    -- Via pending_invites recently accepted (by email) - 2 min grace period
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_email IS NOT NULL
        AND user_email_matches_invite(auth.uid(), pi.invited_email)
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
    -- Via pending_invites token that is still pending (for join flow)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invite_token IS NOT NULL
        AND pi.status = 'pending'
    )
  )
);