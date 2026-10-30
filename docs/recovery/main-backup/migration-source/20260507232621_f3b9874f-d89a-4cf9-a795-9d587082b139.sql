CREATE INDEX IF NOT EXISTS idx_rsvps_event_status ON public.rsvps (event_id, status);
CREATE INDEX IF NOT EXISTS idx_child_team_assignments_team_id ON public.child_team_assignments (team_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_club_folder_active ON public.vault_files (club_id, folder_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vault_folders_club_parent_name ON public.vault_folders (club_id, parent_id, name) WHERE deleted_at IS NULL;