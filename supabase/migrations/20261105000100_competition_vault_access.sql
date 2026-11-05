-- Batch 2 (approved Paul Cranwell, 5 Nov 2026): competition Vault manager access. Structural only.
-- Preserve PROD's existing manager-only competition Vault boundary.
-- Existing folder/file/chat restrictions and Storage policies remain authoritative.
CREATE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.competitions c
   WHERE c.id=_competition_id AND public.is_competition_admin(auth.uid(),c.id))
$$;
CREATE FUNCTION public.can_access_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_manage_competition_vault(_competition_id)
$$;
REVOKE ALL ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) TO authenticated,service_role;
