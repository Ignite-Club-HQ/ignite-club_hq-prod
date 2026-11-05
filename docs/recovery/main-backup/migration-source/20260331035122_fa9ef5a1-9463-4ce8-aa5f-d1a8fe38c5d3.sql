
-- =============================================
-- RLS Refactoring: Replace inline sub-selects with SECURITY DEFINER functions
-- This changes HOW permissions are checked (faster), not WHAT is permitted
-- =============================================

-- 1. Add composite indexes for the most common RLS lookup patterns
CREATE INDEX IF NOT EXISTS idx_user_roles_user_club 
ON public.user_roles (user_id, club_id) WHERE club_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_user_team 
ON public.user_roles (user_id, team_id) WHERE team_id IS NOT NULL;

-- 2. SECURITY DEFINER function: Can viewer see club chat message author profiles?
CREATE OR REPLACE FUNCTION public.is_club_chat_author_visible(_viewer_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_messages cm
    JOIN public.user_roles ur ON ur.club_id = cm.club_id AND ur.user_id = _viewer_id
    WHERE cm.author_id = _profile_id
    AND ur.club_id IS NOT NULL
    LIMIT 1
  )
$$;

-- 3. SECURITY DEFINER function: Can viewer see photo uploader profiles?
CREATE OR REPLACE FUNCTION public.is_photo_uploader_visible(_viewer_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photos p
    JOIN public.user_roles ur ON (
      (ur.club_id = p.club_id AND ur.club_id IS NOT NULL)
      OR (ur.team_id = p.team_id AND ur.team_id IS NOT NULL)
    )
    WHERE p.uploader_id = _profile_id
    AND p.deleted_at IS NULL
    AND ur.user_id = _viewer_id
    LIMIT 1
  )
$$;

-- 4. SECURITY DEFINER function: Can viewer see photo commenter profiles?
CREATE OR REPLACE FUNCTION public.is_photo_commenter_visible(_viewer_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photo_comments pc
    JOIN public.photos p ON p.id = pc.photo_id
    JOIN public.user_roles ur ON (
      (ur.club_id = p.club_id AND ur.club_id IS NOT NULL)
      OR (ur.team_id = p.team_id AND ur.team_id IS NOT NULL)
    )
    WHERE pc.user_id = _profile_id
    AND p.deleted_at IS NULL
    AND ur.user_id = _viewer_id
    LIMIT 1
  )
$$;

-- 5. Drop old inline-subselect policies and replace with function-based ones

DROP POLICY IF EXISTS "Users can view profiles of club chat message authors" ON public.profiles;
CREATE POLICY "Users can view profiles of club chat message authors"
ON public.profiles FOR SELECT
USING (public.is_club_chat_author_visible(auth.uid(), id));

DROP POLICY IF EXISTS "Users can view profiles of photo uploaders in shared clubs/team" ON public.profiles;
CREATE POLICY "Users can view profiles of photo uploaders in shared clubs/team"
ON public.profiles FOR SELECT
USING (public.is_photo_uploader_visible(auth.uid(), id));

DROP POLICY IF EXISTS "Users can view profiles of photo commenters in shared clubs/tea" ON public.profiles;
CREATE POLICY "Users can view profiles of photo commenters in shared clubs/tea"
ON public.profiles FOR SELECT
USING (public.is_photo_commenter_visible(auth.uid(), id));
