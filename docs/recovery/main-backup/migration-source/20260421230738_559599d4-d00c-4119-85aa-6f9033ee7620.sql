-- Track Drive file IDs and modification times on vault files for change detection
ALTER TABLE public.vault_files
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_modified_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vault_files_drive_file_id
  ON public.vault_files (drive_file_id) WHERE drive_file_id IS NOT NULL;

-- Track Drive folder IDs on vault folders so we can mirror sub-folder structure
ALTER TABLE public.vault_folders
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_folders_drive_folder_id
  ON public.vault_folders (drive_folder_id) WHERE drive_folder_id IS NOT NULL;

-- Linked Drive ↔ Vault folder pairs with refresh tokens for background sync
CREATE TABLE public.vault_drive_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  vault_folder_id UUID NOT NULL REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  drive_folder_id TEXT NOT NULL,
  drive_folder_name TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  google_account_email TEXT,
  sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  files_imported_count INTEGER NOT NULL DEFAULT 0,
  files_updated_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vault_folder_id)
);

CREATE INDEX idx_vault_drive_links_club ON public.vault_drive_links (club_id);
CREATE INDEX idx_vault_drive_links_sync ON public.vault_drive_links (sync_enabled, last_synced_at) WHERE sync_enabled = TRUE;

ALTER TABLE public.vault_drive_links ENABLE ROW LEVEL SECURITY;

-- Club admins and the link creator can view links
CREATE POLICY "Club admins can view drive links"
ON public.vault_drive_links
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'app_admin'::app_role)
  OR has_role(auth.uid(), 'club_admin'::app_role)
  OR created_by = auth.uid()
);

CREATE POLICY "Club admins can create drive links"
ON public.vault_drive_links
FOR INSERT
TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'app_admin'::app_role) OR has_role(auth.uid(), 'club_admin'::app_role))
  AND created_by = auth.uid()
);

CREATE POLICY "Club admins can update drive links"
ON public.vault_drive_links
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'app_admin'::app_role)
  OR has_role(auth.uid(), 'club_admin'::app_role)
);

CREATE POLICY "Club admins can delete drive links"
ON public.vault_drive_links
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'app_admin'::app_role)
  OR has_role(auth.uid(), 'club_admin'::app_role)
);

CREATE TRIGGER update_vault_drive_links_updated_at
BEFORE UPDATE ON public.vault_drive_links
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Schedule background sync every 30 minutes
SELECT cron.schedule(
  'drive-folder-sync',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/drive-folder-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('scheduled', true)
  );
  $$
);