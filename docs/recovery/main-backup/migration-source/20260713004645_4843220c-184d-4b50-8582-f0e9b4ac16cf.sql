
-- Add "purged" columns to clubs: marks a soft-deleted club as permanently hidden
-- from the user's Recently removed list, while retaining the row and all child
-- data in the database for audit/recovery by app admins.
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS purged_by uuid;

CREATE INDEX IF NOT EXISTS idx_clubs_purged_at ON public.clubs(purged_at) WHERE purged_at IS NOT NULL;

-- RPC: mark a soft-deleted club as permanently hidden. Only the club creator
-- (or an app_admin) may call it. Requires the club to already be soft-deleted.
-- Blocks purge if the club still has an active paid subscription.
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT created_by, deleted_at INTO _creator, _deleted_at
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
  WHERE club_id = _club_id AND status = 'active';

  IF _active_sub_count > 0 THEN
    RAISE EXCEPTION 'Cancel the active subscription before permanently deleting this club';
  END IF;

  UPDATE public.clubs
     SET purged_at = now(), purged_by = _uid
   WHERE id = _club_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'club.hard_delete', 'club', _club_id,
          jsonb_build_object('purged_at', now(), 'creator', _creator));
END;
$$;

GRANT EXECUTE ON FUNCTION public.hard_delete_club(uuid) TO authenticated;
