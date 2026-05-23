-- Add guardian_id index to speed up is_club_member() guardian branch lookups
-- This fixes statement timeouts on chat/event loads for clubs with many guardian records

CREATE INDEX IF NOT EXISTS idx_child_guardians_guardian_id
  ON public.child_guardians (guardian_id);

-- Rollback (if ever needed):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_child_guardians_guardian_id;