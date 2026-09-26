CREATE OR REPLACE FUNCTION public.broadcast_visible_to_user(_club_ids uuid[], _sent_at timestamptz, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id AND u.created_at <= _sent_at)
    AND (
      _club_ids IS NULL OR array_length(_club_ids, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.club_id = ANY(_club_ids)
          AND ur.created_at <= _sent_at
      )
    );
$$;
REVOKE ALL ON FUNCTION public.broadcast_visible_to_user(uuid[], timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_visible_to_user(uuid[], timestamptz, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view broadcast messages targeted to them" ON public.broadcast_messages;
CREATE POLICY "Users can view broadcast messages targeted to them"
ON public.broadcast_messages FOR SELECT TO authenticated
USING (
  author_id = (SELECT auth.uid())
  OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  OR public.broadcast_visible_to_user(target_club_ids, created_at, (SELECT auth.uid()))
);