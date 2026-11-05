-- Fix overly permissive RLS policies that expose data across clubs/teams
-- This migration restricts SELECT access to only users who are members of the relevant club/team

-- ============================================
-- 1. Fix photo_comments - restrict to photo's club/team members
-- ============================================
DROP POLICY IF EXISTS "Users can view photo comments" ON public.photo_comments;

CREATE POLICY "Users can view comments on accessible photos"
ON public.photo_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM photos p
    WHERE p.id = photo_comments.photo_id
    AND p.deleted_at IS NULL
    AND (
      -- User is member of the photo's club
      (p.club_id IS NOT NULL AND is_club_member(auth.uid(), p.club_id))
      OR
      -- User is member of the photo's team
      (p.team_id IS NOT NULL AND is_team_member(auth.uid(), p.team_id))
      OR
      -- App admins can see all
      has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);

-- ============================================
-- 2. Fix photo_reactions - restrict to photo's club/team members
-- ============================================
DROP POLICY IF EXISTS "Users can view photo reactions" ON public.photo_reactions;

CREATE POLICY "Users can view reactions on accessible photos"
ON public.photo_reactions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM photos p
    WHERE p.id = photo_reactions.photo_id
    AND p.deleted_at IS NULL
    AND (
      (p.club_id IS NOT NULL AND is_club_member(auth.uid(), p.club_id))
      OR
      (p.team_id IS NOT NULL AND is_team_member(auth.uid(), p.team_id))
      OR
      has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);

-- ============================================
-- 3. Fix photo_comment_reactions - restrict via comment's photo's club/team
-- ============================================
DROP POLICY IF EXISTS "Users can view comment reactions" ON public.photo_comment_reactions;

CREATE POLICY "Users can view reactions on accessible comments"
ON public.photo_comment_reactions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM photo_comments pc
    JOIN photos p ON p.id = pc.photo_id
    WHERE pc.id = photo_comment_reactions.comment_id
    AND p.deleted_at IS NULL
    AND (
      (p.club_id IS NOT NULL AND is_club_member(auth.uid(), p.club_id))
      OR
      (p.team_id IS NOT NULL AND is_team_member(auth.uid(), p.team_id))
      OR
      has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);

-- ============================================
-- 4. Fix message_reactions - restrict based on message type membership
-- ============================================
DROP POLICY IF EXISTS "Users can view message reactions" ON public.message_reactions;

CREATE POLICY "Users can view reactions on accessible messages"
ON public.message_reactions FOR SELECT
USING (
  -- Team message reactions - user must be team member
  (
    team_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_messages tm
      WHERE tm.id = message_reactions.team_message_id
      AND is_team_member(auth.uid(), tm.team_id)
    )
  )
  OR
  -- Club message reactions - user must be club member
  (
    club_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM club_messages cm
      WHERE cm.id = message_reactions.club_message_id
      AND is_club_member(auth.uid(), cm.club_id)
    )
  )
  OR
  -- Broadcast message reactions - any authenticated user (broadcasts are global)
  (
    broadcast_message_id IS NOT NULL AND auth.uid() IS NOT NULL
  )
  OR
  -- Group message reactions - user must have access to the chat group
  (
    group_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_messages gm
      WHERE gm.id = message_reactions.group_message_id
      AND can_access_chat_group(auth.uid(), gm.group_id)
    )
  )
  OR
  -- App admins can see all
  has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);

-- ============================================
-- 5. Fix player_of_match - restrict to event's club/team members
-- ============================================
DROP POLICY IF EXISTS "Anyone can view player of match" ON public.player_of_match;

CREATE POLICY "Users can view player of match for accessible events"
ON public.player_of_match FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = player_of_match.event_id
    AND (
      -- User is member of the event's club
      is_club_member(auth.uid(), e.club_id)
      OR
      -- User is member of the event's team
      (e.team_id IS NOT NULL AND is_team_member(auth.uid(), e.team_id))
      OR
      -- App admins can see all
      has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);