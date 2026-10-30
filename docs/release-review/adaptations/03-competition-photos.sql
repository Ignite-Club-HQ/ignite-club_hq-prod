-- REVIEW / LOCAL REHEARSAL ONLY. Preserve existing uploader/manager policies,
-- byte-storage policies and mirror/cleanup triggers; do not stack restrictive scopes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.photos'::regclass
   AND attname='competition_id' AND NOT attisdropped) THEN RAISE EXCEPTION 'Expected photo scope missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.photos'::regclass
   AND tgname='trg_photos_mirror_competition_vault' AND tgenabled='O') THEN RAISE EXCEPTION 'Expected photo mirror missing'; END IF;
END; $$;
-- No new participant grants. Full policy and stored-byte acceptance precedes expansion.