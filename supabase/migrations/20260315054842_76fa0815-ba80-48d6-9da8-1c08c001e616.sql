
-- Create photo_deletion_logs table for audit trail
CREATE TABLE IF NOT EXISTS public.photo_deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL,
  club_id uuid,
  team_id uuid,
  file_url text,
  image_url text,
  file_size bigint,
  deleted_by uuid NOT NULL,
  deletion_type text NOT NULL CHECK (deletion_type IN ('permanent', 'soft', 'auto_purge')),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  original_created_at timestamptz,
  original_uploader_id uuid
);

ALTER TABLE public.photo_deletion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App admins can view all deletion logs"
  ON public.photo_deletion_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'app_admin'
    )
  );

CREATE POLICY "Club admins can view their club deletion logs"
  ON public.photo_deletion_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() 
        AND role = 'club_admin' 
        AND club_id = photo_deletion_logs.club_id
    )
  );

CREATE POLICY "Authenticated can insert photo deletion logs"
  ON public.photo_deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create file_deletion_logs table
CREATE TABLE IF NOT EXISTS public.file_deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  club_id uuid,
  team_id uuid,
  file_url text,
  file_size bigint,
  file_name text,
  deleted_by uuid NOT NULL,
  deletion_type text NOT NULL CHECK (deletion_type IN ('permanent', 'soft', 'auto_purge')),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  original_created_at timestamptz,
  original_uploaded_by uuid
);

ALTER TABLE public.file_deletion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App admins can view all file deletion logs"
  ON public.file_deletion_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'app_admin'
    )
  );

CREATE POLICY "Club admins can view their club file deletion logs"
  ON public.file_deletion_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() 
        AND role = 'club_admin' 
        AND club_id = file_deletion_logs.club_id
    )
  );

CREATE POLICY "Authenticated can insert file deletion logs"
  ON public.file_deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
