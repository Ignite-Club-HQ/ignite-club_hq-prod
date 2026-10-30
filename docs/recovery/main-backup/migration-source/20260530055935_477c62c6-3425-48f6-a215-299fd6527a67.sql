
-- Phase 5a: Add scope_key for narrow realtime subscriptions on message_reads
ALTER TABLE public.message_reads ADD COLUMN IF NOT EXISTS scope_key text;

-- Derivation function: maps a read row's populated FK to its owning scope id
CREATE OR REPLACE FUNCTION public.message_reads_compute_scope_key(_row public.message_reads)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
BEGIN
  IF _row.team_message_id IS NOT NULL THEN
    SELECT team_id::text INTO v_scope FROM public.team_messages WHERE id = _row.team_message_id;
  ELSIF _row.club_message_id IS NOT NULL THEN
    SELECT club_id::text INTO v_scope FROM public.club_messages WHERE id = _row.club_message_id;
  ELSIF _row.group_message_id IS NOT NULL THEN
    SELECT group_id::text INTO v_scope FROM public.group_messages WHERE id = _row.group_message_id;
  ELSIF _row.direct_message_id IS NOT NULL THEN
    SELECT conversation_id::text INTO v_scope FROM public.direct_messages WHERE id = _row.direct_message_id;
  ELSIF _row.club_admin_message_id IS NOT NULL THEN
    SELECT conversation_id::text INTO v_scope FROM public.club_admin_messages WHERE id = _row.club_admin_message_id;
  ELSIF _row.broadcast_message_id IS NOT NULL THEN
    v_scope := 'broadcast';
  END IF;
  RETURN v_scope;
END;
$$;

-- BEFORE INSERT trigger to populate scope_key automatically
CREATE OR REPLACE FUNCTION public.set_message_reads_scope_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scope_key IS NULL THEN
    NEW.scope_key := public.message_reads_compute_scope_key(NEW);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_reads_set_scope_key ON public.message_reads;
CREATE TRIGGER trg_message_reads_set_scope_key
BEFORE INSERT ON public.message_reads
FOR EACH ROW
EXECUTE FUNCTION public.set_message_reads_scope_key();

-- Backfill existing rows (~76k)
UPDATE public.message_reads mr
SET scope_key = tm.team_id::text
FROM public.team_messages tm
WHERE mr.team_message_id = tm.id AND mr.scope_key IS NULL;

UPDATE public.message_reads mr
SET scope_key = cm.club_id::text
FROM public.club_messages cm
WHERE mr.club_message_id = cm.id AND mr.scope_key IS NULL;

UPDATE public.message_reads mr
SET scope_key = gm.group_id::text
FROM public.group_messages gm
WHERE mr.group_message_id = gm.id AND mr.scope_key IS NULL;

UPDATE public.message_reads mr
SET scope_key = dm.conversation_id::text
FROM public.direct_messages dm
WHERE mr.direct_message_id = dm.id AND mr.scope_key IS NULL;

UPDATE public.message_reads mr
SET scope_key = cam.conversation_id::text
FROM public.club_admin_messages cam
WHERE mr.club_admin_message_id = cam.id AND mr.scope_key IS NULL;

UPDATE public.message_reads
SET scope_key = 'broadcast'
WHERE broadcast_message_id IS NOT NULL AND scope_key IS NULL;

-- Index for realtime filter performance
CREATE INDEX IF NOT EXISTS idx_message_reads_scope_key ON public.message_reads (scope_key);
