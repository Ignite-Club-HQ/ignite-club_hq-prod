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
  v_changed BOOLEAN;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ((qual IS NOT NULL AND qual ~ 'auth\.uid\(\)')
        OR (with_check IS NOT NULL AND with_check ~ 'auth\.uid\(\)'))
  LOOP
    -- Replace only bare auth.uid() (not already preceded by "SELECT ").
    -- Trick: temp-protect already-wrapped occurrences, rewrite, then restore.
    v_qual := r.qual;
    v_check := r.with_check;
    v_changed := false;

    IF v_qual IS NOT NULL THEN
      v_qual := replace(v_qual, 'SELECT auth.uid()', '__KEEP_SELECT_AUTH_UID__');
      IF position('auth.uid()' IN v_qual) > 0 THEN
        v_qual := replace(v_qual, 'auth.uid()', '(SELECT auth.uid())');
        v_changed := true;
      END IF;
      v_qual := replace(v_qual, '__KEEP_SELECT_AUTH_UID__', 'SELECT auth.uid()');
    END IF;

    IF v_check IS NOT NULL THEN
      v_check := replace(v_check, 'SELECT auth.uid()', '__KEEP_SELECT_AUTH_UID__');
      IF position('auth.uid()' IN v_check) > 0 THEN
        v_check := replace(v_check, 'auth.uid()', '(SELECT auth.uid())');
        v_changed := true;
      END IF;
      v_check := replace(v_check, '__KEEP_SELECT_AUTH_UID__', 'SELECT auth.uid()');
    END IF;

    IF NOT v_changed THEN
      CONTINUE;
    END IF;

    v_cmd := r.cmd;
    v_permissive := CASE WHEN r.permissive = 'PERMISSIVE' THEN 'AS PERMISSIVE' ELSE 'AS RESTRICTIVE' END;
    v_roles := array_to_string(r.roles, ', ');

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);

    v_sql := format('CREATE POLICY %I ON %I.%I %s FOR %s TO %s',
                    r.policyname, r.schemaname, r.tablename,
                    v_permissive, v_cmd, v_roles);
    IF v_qual  IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_qual || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;

    EXECUTE v_sql;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Rewrote % policies', v_count;
END $$;