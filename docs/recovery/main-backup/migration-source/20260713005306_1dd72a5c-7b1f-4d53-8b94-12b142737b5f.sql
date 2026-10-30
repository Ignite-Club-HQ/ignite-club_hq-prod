
CREATE OR REPLACE FUNCTION public.hard_delete_club(_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _creator uuid;
  _deleted_at timestamptz;
  _active_sub_count int;
  _club_name text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT created_by, deleted_at, name INTO _creator, _deleted_at, _club_name
  FROM public.clubs WHERE id = _club_id;

  IF _creator IS NULL THEN
    RAISE EXCEPTION 'Club not found';
  END IF;

  IF _deleted_at IS NULL THEN
    RAISE EXCEPTION 'Club must be removed before it can be permanently deleted';
  END IF;

  IF _creator <> _uid AND NOT public.has_role(_uid, 'app_admin') THEN
    RAISE EXCEPTION 'Only the club creator can permanently delete this club';
  END IF;

  SELECT count(*) INTO _active_sub_count
  FROM public.club_subscriptions
  WHERE club_id = _club_id
    AND (is_pro = true OR is_pro_football = true)
    AND cancelled_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND stripe_subscription_id IS NOT NULL;

  IF _active_sub_count > 0 THEN
    RAISE EXCEPTION 'Cancel the active Stripe subscription before permanently deleting this club';
  END IF;

  UPDATE public.clubs
     SET purged_at = now(), purged_by = _uid
   WHERE id = _club_id;

  INSERT INTO public.audit_logs (action_type, actor_id, details)
  VALUES ('club.hard_delete', _uid,
          jsonb_build_object('club_id', _club_id, 'club_name', _club_name, 'creator', _creator, 'purged_at', now()));
END;
$$;
