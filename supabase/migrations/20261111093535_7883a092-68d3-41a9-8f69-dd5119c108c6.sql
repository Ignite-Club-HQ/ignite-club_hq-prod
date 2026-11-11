DO $migration$
BEGIN
  IF pg_catalog.to_regprocedure('public.competition_vault_storage_access(text,boolean)') IS NULL THEN
    IF pg_catalog.to_regprocedure('public.can_manage_competition_vault(uuid)') IS NULL
      OR pg_catalog.to_regprocedure('public.can_access_competition_vault(uuid)') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=pg_catalog.to_regclass('public.competitions') AND attname='organizer_club_id' AND NOT attisdropped)
    THEN RAISE EXCEPTION 'Competition Vault dependency repair held: required access helpers or host club column missing'; END IF;
    EXECUTE $definition$
      CREATE FUNCTION public.competition_vault_storage_access(_object_name text, _manage boolean)
      RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $body$
      DECLARE v_competition_id uuid; v_club_id uuid;
      BEGIN
        IF auth.uid() IS NULL OR _object_name IS NULL OR _manage IS NULL THEN RETURN false; END IF;
        IF split_part(_object_name,'/',1)<>'clubs' OR split_part(_object_name,'/',3)<>'competitions'
          OR split_part(_object_name,'/',2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR split_part(_object_name,'/',4) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN RETURN false; END IF;
        v_club_id:=split_part(_object_name,'/',2)::uuid;
        v_competition_id:=split_part(_object_name,'/',4)::uuid;
        RETURN EXISTS (SELECT 1 FROM public.competitions c WHERE c.id=v_competition_id
          AND c.organizer_club_id=v_club_id AND CASE WHEN _manage THEN public.can_manage_competition_vault(c.id)
          ELSE public.can_access_competition_vault(c.id) END);
      END;
      $body$;
    $definition$;
    REVOKE ALL ON FUNCTION public.competition_vault_storage_access(text,boolean) FROM PUBLIC,anon;
    GRANT EXECUTE ON FUNCTION public.competition_vault_storage_access(text,boolean) TO authenticated,service_role;
  END IF;
END;
$migration$;