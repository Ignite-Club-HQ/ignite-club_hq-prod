DO $migration$
DECLARE definition text; marker text; guard text; name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['claim_pending_invites_on_profile_create','auto_accept_pending_invites_on_role'] LOOP
    definition := pg_get_functiondef(('public.' || name || '()')::regprocedure);
    marker := CASE WHEN name='claim_pending_invites_on_profile_create' THEN 'WHERE pi.status IN (''pending'', ''accepted'')' ELSE 'WHERE pi.status = ''pending''' END;
    guard := ' AND (NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = ' || CASE WHEN name='claim_pending_invites_on_profile_create' THEN 'NEW.id' ELSE 'NEW.user_id' END || ' AND NULLIF(btrim(au.raw_user_meta_data->>''email_signup_invite_token''), '''') IS NOT NULL)' ||
      ' OR pi.invite_token = (SELECT au.raw_user_meta_data->>''email_signup_invite_token'' FROM auth.users au WHERE au.id = ' || CASE WHEN name='claim_pending_invites_on_profile_create' THEN 'NEW.id' ELSE 'NEW.user_id' END || '))';
    IF position(marker in definition)=0 THEN RAISE EXCEPTION 'Unexpected invitation claimant definition'; END IF;
    definition := replace(definition, marker, marker || guard);
    IF name='auto_accept_pending_invites_on_role' THEN
      definition := replace(definition, 'WHERE pi.status IN (''pending'', ''accepted'')', 'WHERE pi.status IN (''pending'', ''accepted'')' || guard);
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$migration$;