
-- Trigger to keep clubs.is_pro in sync with club_subscriptions
-- When club_subscriptions is updated, sync the is_pro flag on clubs table
CREATE OR REPLACE FUNCTION public.sync_club_is_pro()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_pro boolean;
BEGIN
  -- Determine if the club should be considered Pro
  _is_pro := (
    NEW.is_pro OR NEW.is_pro_football OR 
    NEW.admin_pro_override OR NEW.admin_pro_football_override
  ) AND (NEW.expires_at IS NULL OR NEW.expires_at > now());

  UPDATE public.clubs
  SET is_pro = _is_pro, updated_at = now()
  WHERE id = NEW.club_id AND is_pro IS DISTINCT FROM _is_pro;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_sync_club_is_pro ON public.club_subscriptions;

-- Create trigger on club_subscriptions updates and inserts
CREATE TRIGGER trigger_sync_club_is_pro
  AFTER INSERT OR UPDATE OF is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at
  ON public.club_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_club_is_pro();
