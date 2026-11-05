-- Restrict sensitive columns from direct SELECT by anon/authenticated.
-- Edge functions (service-role) and SECURITY DEFINER RPCs are unaffected.

REVOKE SELECT (refresh_token) ON public.vault_drive_links FROM anon, authenticated;
REVOKE SELECT (claim_token)   ON public.eoi_submissions   FROM anon, authenticated;
REVOKE SELECT (contact_email) ON public.business_profiles FROM anon, authenticated;

-- Re-grant SELECT on all OTHER columns explicitly so the table remains readable per RLS.
GRANT SELECT (id, club_id, team_id, vault_folder_id, drive_folder_id, drive_folder_name,
              google_account_email, sync_enabled, sync_interval_minutes, last_synced_at,
              last_sync_status, last_sync_error, files_imported_count, files_updated_count,
              last_failed_files, created_by, created_at, updated_at)
  ON public.vault_drive_links TO authenticated;

GRANT SELECT (id, club_id, season_id, parent_user_id, child_id, assigned_team_id,
              parent_name, parent_email, parent_mobile, player_name, player_dob,
              player_gender, age_group, preferred_teammates, preferred_position,
              skill_level, notes, returning_player, training_days, game_days, status,
              source, claimed_at, submitted_at, allocated_at, confirmed_at,
              registered_at, withdrawn_at, created_at, updated_at, invite_sent_at,
              invite_sent_count, parent_confirmed_at, extra_notes)
  ON public.eoi_submissions TO authenticated;

GRANT SELECT (id, user_id, company_name, website_url, logo_url, description, industry,
              city, state, latitude, longitude, preferred_benefits, preferred_tiers,
              is_visible, created_at, updated_at, notify_renewals)
  ON public.business_profiles TO authenticated;