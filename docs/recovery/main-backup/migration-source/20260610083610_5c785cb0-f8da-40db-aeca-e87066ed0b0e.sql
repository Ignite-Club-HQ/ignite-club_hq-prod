CREATE OR REPLACE FUNCTION public.admin_upsert_rsvp(p_event_id uuid, p_user_id uuid, p_status text, p_acting_user_id uuid, p_child_id uuid DEFAULT NULL::uuid, p_mini_league_player_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
  v_mini_league_id uuid;
  v_allowed boolean := false;
BEGIN
  PERFORM set_config('app.acting_user_id', p_acting_user_id::text, true);

  -- If event is a mini-league event, enforce that the RSVP target is
  -- rostered to that league (player, child of league player, or parent
  -- of a league player). League admins may also be RSVP'd.
  SELECT mini_league_id INTO v_mini_league_id FROM public.events WHERE id = p_event_id;

  IF v_mini_league_id IS NOT NULL THEN
    IF p_mini_league_player_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.mini_league_players
        WHERE id = p_mini_league_player_id AND mini_league_id = v_mini_league_id
      ) INTO v_allowed;
    ELSIF p_child_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.mini_league_players
        WHERE child_id = p_child_id AND mini_league_id = v_mini_league_id
      ) INTO v_allowed;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.mini_league_players
        WHERE parent_user_id = p_user_id AND mini_league_id = v_mini_league_id
      ) OR EXISTS (
        SELECT 1 FROM public.mini_league_admins
        WHERE user_id = p_user_id AND mini_league_id = v_mini_league_id
      ) INTO v_allowed;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Only mini-league players (or their parents) can be added to this game'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_child_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.rsvps
    WHERE event_id = p_event_id AND child_id = p_child_id
    LIMIT 1;
  ELSIF p_mini_league_player_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.rsvps
    WHERE event_id = p_event_id AND mini_league_player_id = p_mini_league_player_id
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id FROM public.rsvps
    WHERE event_id = p_event_id AND user_id = p_user_id AND child_id IS NULL AND mini_league_player_id IS NULL
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.rsvps SET status = p_status::rsvp_status WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.rsvps (event_id, user_id, status, child_id, mini_league_player_id)
    VALUES (p_event_id, p_user_id, p_status::rsvp_status, p_child_id, p_mini_league_player_id);
  END IF;
END;
$function$;