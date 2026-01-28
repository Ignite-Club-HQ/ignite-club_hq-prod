-- Add mini_league_id column to photos table
ALTER TABLE public.photos 
ADD COLUMN mini_league_id UUID REFERENCES public.mini_leagues(id) ON DELETE SET NULL;

-- Create index for mini_league_id lookups
CREATE INDEX idx_photos_mini_league_id ON public.photos(mini_league_id) WHERE mini_league_id IS NOT NULL;

-- Update RLS policies to allow mini-league photo access
-- Users can view photos from mini-leagues they are admin of or have children in
CREATE POLICY "Users can view mini-league photos" ON public.photos
FOR SELECT USING (
  mini_league_id IS NOT NULL AND (
    -- League admin, coach, or club admin
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = photos.mini_league_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
    )
    OR
    -- Parent with child in the league
    EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.mini_league_id = photos.mini_league_id
      AND mlp.parent_user_id = auth.uid()
    )
  )
);

-- Allow users with appropriate roles to insert mini-league photos
CREATE POLICY "Users can upload mini-league photos" ON public.photos
FOR INSERT WITH CHECK (
  mini_league_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = photos.mini_league_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
    )
    OR
    EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.mini_league_id = photos.mini_league_id
      AND mlp.parent_user_id = auth.uid()
    )
  )
);

-- Allow admins and uploaders to update mini-league photos
CREATE POLICY "Users can update mini-league photos" ON public.photos
FOR UPDATE USING (
  mini_league_id IS NOT NULL AND (
    uploader_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = photos.mini_league_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
    )
  )
);

-- Allow admins and uploaders to delete mini-league photos
CREATE POLICY "Users can delete mini-league photos" ON public.photos
FOR DELETE USING (
  mini_league_id IS NOT NULL AND (
    uploader_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = photos.mini_league_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
    )
  )
);