
-- Trigger function: when a user_roles row is inserted, auto-accept any matching pending invites
CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  -- Look up the new user's email once for fallback matching
  SELECT lower(au.email) INTO v_email
  FROM auth.users au
  WHERE au.id = NEW.user_id;

  -- Mark any pending invites for this team/club as accepted, matching by
  -- (a) invited_user_id == NEW.user_id, OR
  -- (b) invited_email matches the user's email (case-insensitive)
  -- Scoped to team OR club depending on which the role is for.
  UPDATE public.pending_invites pi
  SET status = 'accepted',
      accepted_at = COALESCE(pi.accepted_at, now()),
      invited_user_id = COALESCE(pi.invited_user_id, NEW.user_id)
  WHERE pi.status = 'pending'
    AND (
      pi.invited_user_id = NEW.user_id
      OR (v_email IS NOT NULL AND lower(pi.invited_email) = v_email)
    )
    AND (
      (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
      OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_accept_pending_invites ON public.user_roles;
CREATE TRIGGER trg_auto_accept_pending_invites
AFTER INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.auto_accept_pending_invites_on_role();

-- One-time cleanup: resolve all existing ghost pending invites where the
-- invited person is already an active member of the target team/club.
UPDATE public.pending_invites pi
SET status = 'accepted',
    accepted_at = COALESCE(pi.accepted_at, now()),
    invited_user_id = COALESCE(pi.invited_user_id, matched.user_id)
FROM (
  SELECT DISTINCT pi2.id AS invite_id, ur.user_id
  FROM public.pending_invites pi2
  LEFT JOIN auth.users au ON lower(au.email) = lower(pi2.invited_email)
  JOIN public.user_roles ur
    ON ur.user_id = COALESCE(pi2.invited_user_id, au.id)
   AND (
     (pi2.team_id IS NOT NULL AND ur.team_id = pi2.team_id)
     OR (pi2.team_id IS NULL AND pi2.club_id IS NOT NULL AND ur.club_id = pi2.club_id)
   )
  WHERE pi2.status = 'pending'
) matched
WHERE pi.id = matched.invite_id
  AND pi.status = 'pending';
