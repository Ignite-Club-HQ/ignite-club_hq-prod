-- Prevent duplicate message read inserts from raising database errors.
-- This catches any client path that attempts to insert an already-existing read row.
CREATE OR REPLACE FUNCTION public.skip_duplicate_message_reads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND team_message_id = NEW.team_message_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.club_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND club_message_id = NEW.club_message_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.group_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND group_message_id = NEW.group_message_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.broadcast_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND broadcast_message_id = NEW.broadcast_message_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.direct_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND direct_message_id = NEW.direct_message_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.club_admin_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_reads
    WHERE user_id = NEW.user_id AND club_admin_message_id = NEW.club_admin_message_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skip_duplicate_message_reads_before_insert ON public.message_reads;
CREATE TRIGGER skip_duplicate_message_reads_before_insert
BEFORE INSERT ON public.message_reads
FOR EACH ROW
EXECUTE FUNCTION public.skip_duplicate_message_reads();

-- Ensure club admin chat read receipts have the same uniqueness protection as other chat types.
WITH duplicate_club_admin_reads AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, club_admin_message_id
           ORDER BY id
         ) AS duplicate_rank
  FROM public.message_reads
  WHERE club_admin_message_id IS NOT NULL
)
DELETE FROM public.message_reads mr
USING duplicate_club_admin_reads d
WHERE mr.id = d.id
  AND d.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_club_admin_message
ON public.message_reads (user_id, club_admin_message_id)
WHERE club_admin_message_id IS NOT NULL;

-- The app inserts an activity row and asks PostgREST to return its id.
-- Users therefore need to be able to read their own activity rows, while admins retain all-log visibility.
CREATE POLICY "Users can read own activity"
ON public.user_activity_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);