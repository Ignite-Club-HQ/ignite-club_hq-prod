-- REVIEW / LOCAL REHEARSAL ONLY. Compatibility helpers preserve manager-only PROD
-- competition Vault; participant expansion, policies and new bucket remain held.
-- Existing restrictive folder/file rules, chat gates, roots and mirrors stay intact.
CREATE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.competitions c WHERE c.id=_competition_id
   AND (public.is_competition_role_admin(auth.uid(),c.id) OR public.has_role(auth.uid(),'app_admin'::public.app_role)))
$$;
CREATE FUNCTION public.can_access_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_manage_competition_vault(_competition_id)
$$;
REVOKE ALL ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) TO authenticated,service_role;
-- Intentionally not can_access_vault_folder/file: broad helper predicates cannot
-- substitute complete chat-linked/restricted-role/parent/storage policy composition.