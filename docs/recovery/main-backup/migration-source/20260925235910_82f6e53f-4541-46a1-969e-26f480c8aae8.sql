CREATE OR REPLACE FUNCTION public.broadcast_visible_to_user(_club_ids uuid[], _sent_at timestamptz, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL
    AND (_user_id = auth.uid() OR auth.role() = 'service_role')
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