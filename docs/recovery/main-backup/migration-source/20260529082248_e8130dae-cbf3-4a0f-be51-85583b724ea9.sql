-- ============================================================
-- Bulk safe RLS perf pass.
-- For every policy in the public schema whose USING or WITH CHECK
-- expression contains a bare auth.uid(), rebuild it with
-- auth.uid() replaced by (SELECT auth.uid()) so Postgres caches
-- the value once per query instead of once per row.
-- Pure mechanical rewrite — no semantics change. Atomic.
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_cmd TEXT;
  v_permissive TEXT;
  v_roles TEXT;
  v_qual TEXT;
  v_check TEXT;
  v_sql TEXT;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual       IS NOT NULL AND qual       ~ 'auth\.uid\(\)' AND qual       !~ '\(\s*SELECT\s+auth\.uid\(\)\s*\)')
        OR
        (with_check IS NOT NULL AND with_check ~ 'auth\.uid\(\)' AND with_check !~ '\(\s*SELECT\s+auth\.uid\(\)\s*\)')
      )
  LOOP
    -- Rewrite: bare auth.uid() -> (SELECT auth.uid())
    -- Safe even where some occurrences are already wrapped (double-wrap collapses in planner).
    v_qual  := CASE WHEN r.qual       IS NOT NULL THEN regexp_replace(r.qual,       'auth\.uid\(\)', '(SELECT auth.uid())', 'g') END;
    v_check := CASE WHEN r.with_check IS NOT NULL THEN regexp_replace(r.with_check, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g') END;

    v_cmd := CASE r.cmd
               WHEN 'ALL'    THEN 'ALL'
               WHEN 'SELECT' THEN 'SELECT'
               WHEN 'INSERT' THEN 'INSERT'
               WHEN 'UPDATE' THEN 'UPDATE'
               WHEN 'DELETE' THEN 'DELETE'
             END;

    v_permissive := CASE WHEN r.permissive = 'PERMISSIVE' THEN 'AS PERMISSIVE' ELSE 'AS RESTRICTIVE' END;
    v_roles := array_to_string(r.roles, ', ');

    -- Drop
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);

    -- Recreate
    v_sql := format('CREATE POLICY %I ON %I.%I %s FOR %s TO %s',
                    r.policyname, r.schemaname, r.tablename,
                    v_permissive, v_cmd, v_roles);

    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || v_qual || ')';
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || v_check || ')';
    END IF;

    EXECUTE v_sql;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Rewrote % policies', v_count;
END $$;