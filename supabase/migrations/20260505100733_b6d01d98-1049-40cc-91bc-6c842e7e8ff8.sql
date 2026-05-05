
-- Overloaded 3-arg variants that route to per-club tables
CREATE OR REPLACE FUNCTION public.increment_ignite_points(
  _user_id uuid, _amount integer, _club_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_total integer;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;

  IF _club_id IS NULL THEN
    -- Legacy path: update global column only
    UPDATE public.profiles
    SET ignite_points = GREATEST(0, ignite_points + _amount)
    WHERE id = _user_id
    RETURNING ignite_points INTO new_total;
    RETURN COALESCE(new_total, 0);
  END IF;

  INSERT INTO public.user_club_points(user_id, club_id, points, updated_at)
  VALUES (_user_id, _club_id, GREATEST(0, _amount), now())
  ON CONFLICT (user_id, club_id) DO UPDATE
    SET points = GREATEST(0, public.user_club_points.points + _amount),
        updated_at = now()
  RETURNING points INTO new_total;

  -- Mirror to legacy global column to keep older reads working during transition
  UPDATE public.profiles
  SET ignite_points = GREATEST(0, COALESCE(ignite_points, 0) + _amount)
  WHERE id = _user_id;

  RETURN COALESCE(new_total, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_child_ignite_points(
  _child_id uuid, _amount integer, _club_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_total integer;
BEGIN
  IF _child_id IS NULL THEN RETURN 0; END IF;

  IF _club_id IS NULL THEN
    UPDATE public.children
    SET ignite_points = GREATEST(0, ignite_points + _amount)
    WHERE id = _child_id
    RETURNING ignite_points INTO new_total;
    RETURN COALESCE(new_total, 0);
  END IF;

  INSERT INTO public.child_club_points(child_id, club_id, points, updated_at)
  VALUES (_child_id, _club_id, GREATEST(0, _amount), now())
  ON CONFLICT (child_id, club_id) DO UPDATE
    SET points = GREATEST(0, public.child_club_points.points + _amount),
        updated_at = now()
  RETURNING points INTO new_total;

  UPDATE public.children
  SET ignite_points = GREATEST(0, COALESCE(ignite_points, 0) + _amount)
  WHERE id = _child_id;

  RETURN COALESCE(new_total, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_ignite_points(uuid, integer, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_child_ignite_points(uuid, integer, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.increment_ignite_points(uuid, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_child_ignite_points(uuid, integer, uuid) TO authenticated, service_role;
