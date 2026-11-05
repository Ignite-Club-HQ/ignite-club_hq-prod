-- Drop exact-duplicate indexes on message_reads to reduce write amplification.
-- idx_message_reads_team_user is identical to idx_message_reads_team_message_user.
-- idx_message_reads_team_message_id (single col) is fully covered by the composite (team_message_id, user_id).
DROP INDEX IF EXISTS public.idx_message_reads_team_user;
DROP INDEX IF EXISTS public.idx_message_reads_team_message_id;

-- Add clubs(name) index to support ORDER BY name in club selectors (currently seq-scans).
CREATE INDEX IF NOT EXISTS idx_clubs_name ON public.clubs (name);