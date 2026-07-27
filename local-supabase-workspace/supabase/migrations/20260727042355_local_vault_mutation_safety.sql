-- 1. Canonical storage metadata on vault_files (additive)
ALTER TABLE public.vault_files
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text;

-- 2. Durable deletion job ledger -------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('photo','file')),
  record_id uuid NOT NULL,
  club_id uuid,
  team_id uuid,
  bucket text,
  object_path text,
  requested_by uuid NOT NULL,
  deletion_type text NOT NULL DEFAULT 'permanent',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','storage_deleted','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, record_id)
);

GRANT ALL ON public.vault_deletion_jobs TO service_role;
ALTER TABLE public.vault_deletion_jobs ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: no anon/authenticated access.

-- 3. Storage quota reservations --------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_storage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','committed','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

CREATE INDEX IF NOT EXISTS idx_vault_storage_reservations_club_active
  ON public.vault_storage_reservations (club_id) WHERE status = 'active';

GRANT ALL ON public.vault_storage_reservations TO service_role;
ALTER TABLE public.vault_storage_reservations ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: reservations are only manipulated via RPCs.

-- 4. Scope resolution + authorization --------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_vault_record_scope(
  _kind text,
  _record_id uuid
)
RETURNS TABLE (
  found boolean,
  reason text,
  effective_club_id uuid,
  team_id uuid,
  mini_league_id uuid,
  owner_id uuid,
  file_url text,
  image_url text,
  file_size bigint,
  created_at timestamptz,
  storage_bucket text,
  storage_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  direct_club uuid;
  team_club uuid;
  league_club uuid;
  candidates uuid[];
BEGIN
  IF _kind = 'photo' THEN
    SELECT p.id, p.club_id, p.team_id, p.mini_league_id, p.uploader_id AS owner_id,
           p.file_url, p.image_url, p.file_size, p.created_at,
           NULL::text AS storage_bucket, NULL::text AS storage_path
      INTO r
      FROM public.photos p WHERE p.id = _record_id;
  ELSIF _kind = 'file' THEN
    SELECT f.id, f.club_id, f.team_id, f.mini_league_id, f.uploaded_by AS owner_id,
           f.file_url, NULL::text AS image_url, f.file_size, f.created_at,
           f.storage_bucket, f.storage_path
      INTO r
      FROM public.vault_files f WHERE f.id = _record_id;
  ELSE
    RETURN QUERY SELECT false, 'invalid_kind', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF r.id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  direct_club := r.club_id;

  IF r.team_id IS NOT NULL THEN
    SELECT t.club_id INTO team_club FROM public.teams t WHERE t.id = r.team_id;
    IF team_club IS NULL THEN
      RETURN QUERY SELECT true, 'unresolvable_team_scope', NULL::uuid, r.team_id, r.mini_league_id, r.owner_id,
                          r.file_url, r.image_url, r.file_size, r.created_at, r.storage_bucket, r.storage_path;
      RETURN;
    END IF;
  END IF;

  IF r.mini_league_id IS NOT NULL THEN
    SELECT m.club_id INTO league_club FROM public.mini_leagues m WHERE m.id = r.mini_league_id;
    IF league_club IS NULL THEN
      RETURN QUERY SELECT true, 'unresolvable_league_scope', NULL::uuid, r.team_id, r.mini_league_id, r.owner_id,
                          r.file_url, r.image_url, r.file_size, r.created_at, r.storage_bucket, r.storage_path;
      RETURN;
    END IF;
  END IF;

  candidates := ARRAY(
    SELECT DISTINCT c FROM unnest(ARRAY[direct_club, team_club, league_club]) AS c WHERE c IS NOT NULL
  );

  IF array_length(candidates, 1) IS NULL THEN
    RETURN QUERY SELECT true, 'no_scope', NULL::uuid, r.team_id, r.mini_league_id, r.owner_id,
                        r.file_url, r.image_url, r.file_size, r.created_at, r.storage_bucket, r.storage_path;
    RETURN;
  END IF;

  IF array_length(candidates, 1) > 1 THEN
    RETURN QUERY SELECT true, 'scope_conflict', NULL::uuid, r.team_id, r.mini_league_id, r.owner_id,
                        r.file_url, r.image_url, r.file_size, r.created_at, r.storage_bucket, r.storage_path;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok', candidates[1], r.team_id, r.mini_league_id, r.owner_id,
                      r.file_url, r.image_url, r.file_size, r.created_at, r.storage_bucket, r.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_vault_record_scope(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_vault_record_scope(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_vault_deletion(
  _caller_id uuid,
  _kind text,
  _record_id uuid
)
RETURNS TABLE (
  authorized boolean,
  reason text,
  effective_club_id uuid,
  team_id uuid,
  mini_league_id uuid,
  owner_id uuid,
  file_url text,
  image_url text,
  file_size bigint,
  created_at timestamptz,
  storage_bucket text,
  storage_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s record;
  ok boolean := false;
BEGIN
  IF _caller_id IS NULL THEN
    RETURN QUERY SELECT false, 'unauthorized', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO s FROM public.resolve_vault_record_scope(_kind, _record_id);

  -- App admins may delete anything that exists.
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _caller_id AND ur.role = 'app_admin'
  ) THEN
    IF NOT s.found THEN
      RETURN QUERY SELECT false, s.reason, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                          NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT true, 'app_admin', s.effective_club_id, s.team_id, s.mini_league_id, s.owner_id,
                        s.file_url, s.image_url, s.file_size, s.created_at, s.storage_bucket, s.storage_path;
    RETURN;
  END IF;

  IF NOT s.found OR s.reason <> 'ok' OR s.effective_club_id IS NULL THEN
    RETURN QUERY SELECT false, COALESCE(s.reason, 'not_found'), NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Club admin / committee member of the effective club.
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _caller_id
      AND ur.role IN ('club_admin','committee_member')
      AND ur.club_id = s.effective_club_id
  ) INTO ok;

  -- Team admin of the exact team.
  IF NOT ok AND s.team_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _caller_id
        AND ur.role = 'team_admin'
        AND ur.team_id = s.team_id
    ) INTO ok;
  END IF;

  -- Mini-league admin of the exact mini-league (and its club).
  IF NOT ok AND s.mini_league_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.mini_league_admins mla
      JOIN public.mini_leagues ml ON ml.id = mla.mini_league_id
      WHERE mla.user_id = _caller_id
        AND mla.mini_league_id = s.mini_league_id
        AND ml.club_id = s.effective_club_id
    ) INTO ok;
  END IF;

  -- Original uploader of the exact record.
  IF NOT ok AND s.owner_id IS NOT NULL AND s.owner_id = _caller_id THEN
    ok := true;
  END IF;

  IF NOT ok THEN
    RETURN QUERY SELECT false, 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::text, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok', s.effective_club_id, s.team_id, s.mini_league_id, s.owner_id,
                      s.file_url, s.image_url, s.file_size, s.created_at, s.storage_bucket, s.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_vault_deletion(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_vault_deletion(uuid, text, uuid) TO service_role;

-- 5. Deletion lifecycle RPCs ------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_vault_deletion(
  _caller_id uuid,
  _kind text,
  _record_id uuid,
  _bucket text,
  _object_path text,
  _deletion_type text DEFAULT 'permanent'
)
RETURNS TABLE (job_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a record;
  j record;
BEGIN
  SELECT * INTO a FROM public.authorize_vault_deletion(_caller_id, _kind, _record_id);
  IF a IS NULL OR NOT a.authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO j FROM public.vault_deletion_jobs
   WHERE kind = _kind AND record_id = _record_id FOR UPDATE;

  IF j.id IS NULL THEN
    INSERT INTO public.vault_deletion_jobs (
      kind, record_id, club_id, team_id, bucket, object_path,
      requested_by, deletion_type, status
    ) VALUES (
      _kind, _record_id, a.effective_club_id, a.team_id, _bucket, _object_path,
      _caller_id, _deletion_type, 'pending'
    )
    RETURNING * INTO j;

    -- Audit record written in the same transaction as the job creation.
    IF _kind = 'photo' THEN
      INSERT INTO public.photo_deletion_logs (
        photo_id, club_id, team_id, file_url, image_url, file_size,
        deleted_by, deletion_type, original_created_at, original_uploader_id
      ) VALUES (
        _record_id, a.effective_club_id, a.team_id, a.file_url, a.image_url, a.file_size,
        _caller_id, _deletion_type, a.created_at, a.owner_id
      );
    ELSE
      INSERT INTO public.file_deletion_logs (
        file_id, club_id, team_id, file_url, file_size,
        deleted_by, deletion_type, original_created_at, original_uploaded_by
      ) VALUES (
        _record_id, a.effective_club_id, a.team_id, a.file_url, a.file_size,
        _caller_id, _deletion_type, a.created_at, a.owner_id
      );
    END IF;
  ELSE
    UPDATE public.vault_deletion_jobs
       SET attempts = attempts + 1,
           bucket = COALESCE(_bucket, bucket),
           object_path = COALESCE(_object_path, object_path),
           updated_at = now()
     WHERE id = j.id
     RETURNING * INTO j;
  END IF;

  RETURN QUERY SELECT j.id, j.status;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_vault_deletion(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_vault_deletion(uuid, text, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_vault_deletion(_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  j record;
BEGIN
  SELECT * INTO j FROM public.vault_deletion_jobs WHERE id = _job_id FOR UPDATE;
  IF j.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF j.kind = 'photo' THEN
    DELETE FROM public.photos WHERE id = j.record_id;
  ELSE
    DELETE FROM public.vault_files WHERE id = j.record_id;
  END IF;

  UPDATE public.vault_deletion_jobs
     SET status = 'completed', last_error_code = NULL, updated_at = now()
   WHERE id = _job_id;

  RETURN 'completed';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_vault_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_vault_deletion(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_vault_deletion(_job_id uuid, _error_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.vault_deletion_jobs
     SET status = 'pending',
         last_error_code = _error_code,
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = _job_id;
  RETURN 'retryable';
END;
$$;

REVOKE ALL ON FUNCTION public.fail_vault_deletion(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_vault_deletion(uuid, text) TO service_role;

-- 6. Atomic storage quota reservations --------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_vault_storage(
  _club_id uuid,
  _bytes bigint
)
RETURNS TABLE (reservation_id uuid, limit_bytes bigint, used_bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  is_app_admin boolean;
  sub record;
  v_limit bigint;
  v_used bigint;
  v_reserved bigint;
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF _club_id IS NULL OR _bytes IS NULL OR _bytes < 0 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.role = 'app_admin'
  ) INTO is_app_admin;

  IF NOT is_app_admin AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.club_id = _club_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent reservations for this club.
  PERFORM pg_advisory_xact_lock(hashtextextended(_club_id::text, 0));

  SELECT is_pro, COALESCE(storage_purchased_gb, 0) AS gb
    INTO sub
    FROM public.club_subscriptions
   WHERE club_id = _club_id;

  IF sub IS NULL THEN
    v_limit := 25 * 1024 * 1024; -- Free tier file allowance
  ELSIF COALESCE(sub.is_pro, false) THEN
    v_limit := (5::bigint * 1024 * 1024 * 1024) + (sub.gb::bigint * 1024 * 1024 * 1024);
  ELSE
    v_limit := (25::bigint * 1024 * 1024) + (sub.gb::bigint * 1024 * 1024 * 1024);
  END IF;

  SELECT COALESCE(SUM(file_size), 0) INTO v_used
    FROM public.vault_files
   WHERE club_id = _club_id AND deleted_at IS NULL;

  SELECT COALESCE(SUM(bytes), 0) INTO v_reserved
    FROM public.vault_storage_reservations
   WHERE club_id = _club_id AND status = 'active' AND expires_at > now();

  IF NOT is_app_admin AND (v_used + v_reserved + _bytes) > v_limit THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = '53100';
  END IF;

  INSERT INTO public.vault_storage_reservations (club_id, user_id, bytes)
  VALUES (_club_id, caller, _bytes)
  RETURNING id INTO new_id;

  RETURN QUERY SELECT new_id, v_limit, v_used + v_reserved;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_vault_storage(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_vault_storage(uuid, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_vault_storage(_reservation_id uuid, _committed boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.vault_storage_reservations
     SET status = CASE WHEN _committed THEN 'committed' ELSE 'released' END
   WHERE id = _reservation_id AND user_id = caller AND status = 'active';

  RETURN CASE WHEN _committed THEN 'committed' ELSE 'released' END;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_vault_storage(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_vault_storage(uuid, boolean) TO authenticated, service_role;