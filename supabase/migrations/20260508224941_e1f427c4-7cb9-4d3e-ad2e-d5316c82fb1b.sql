CREATE OR REPLACE FUNCTION public.admin_update_rsvp_status(p_rsvp_id uuid, p_status text, p_acting_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('app.acting_user_id', p_acting_user_id::text, true);
  UPDATE public.rsvps
  SET status = p_status::rsvp_status
  WHERE id = p_rsvp_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_rsvp(p_event_id uuid, p_user_id uuid, p_status text, p_acting_user_id uuid, p_child_id uuid DEFAULT NULL::uuid, p_mini_league_player_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
BEGIN
  PERFORM set_config('app.acting_user_id', p_acting_user_id::text, true);

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