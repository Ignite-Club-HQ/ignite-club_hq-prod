ALTER TABLE public.broadcast_messages
  ADD COLUMN IF NOT EXISTS target_club_ids uuid[] DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.broadcast_targets_user(_club_ids uuid[], _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _club_ids IS NULL
      OR array_length(_club_ids, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.club_id = ANY(_club_ids)
      );
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_targets_user(uuid[], uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "All users can view broadcast messages" ON public.broadcast_messages;

CREATE POLICY "Users can view broadcast messages targeted to them"
ON public.broadcast_messages
FOR SELECT
USING (
  (SELECT auth.uid()) IS NOT NULL
  AND (
    public.broadcast_targets_user(target_club_ids, (SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  )
);