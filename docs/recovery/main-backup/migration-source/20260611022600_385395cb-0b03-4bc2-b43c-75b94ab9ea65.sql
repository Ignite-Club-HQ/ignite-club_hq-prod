
CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  r record;
  v_child uuid;
  v_league uuid;
  v_player uuid;
BEGIN
  SELECT lower(au.email) INTO v_email
  FROM auth.users au
  WHERE au.id = NEW.user_id;

  -- Wire up any mini-league parent invites BEFORE marking accepted
  FOR r IN
    SELECT pi.*
    FROM public.pending_invites pi
    WHERE pi.status = 'pending'
      AND pi.role = 'parent'
      AND (
        pi.invited_user_id = NEW.user_id
        OR (v_email IS NOT NULL AND lower(pi.invited_email) = v_email)
      )
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
      AND pi.metadata ? 'mini_league_id'
      AND pi.metadata ? 'child_id'
  LOOP
    v_child  := NULLIF(r.metadata->>'child_id','')::uuid;
    v_league := NULLIF(r.metadata->>'mini_league_id','')::uuid;
    v_player := NULLIF(r.metadata->>'player_id','')::uuid;

    IF v_child IS NOT NULL THEN
      UPDATE public.children
         SET parent_id = NEW.user_id
       WHERE id = v_child
         AND parent_id IS NULL;

      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (v_child, NEW.user_id, 'parent', true)
      ON CONFLICT DO NOTHING;

      IF v_league IS NOT NULL THEN
        INSERT INTO public.child_mini_league_assignments (child_id, mini_league_id, ability_rating)
        VALUES (v_child, v_league, 3)
        ON CONFLICT DO NOTHING;

        IF v_player IS NOT NULL THEN
          UPDATE public.mini_league_players
             SET parent_user_id = NEW.user_id
           WHERE id = v_player AND parent_user_id IS NULL;
        ELSE
          UPDATE public.mini_league_players
             SET parent_user_id = NEW.user_id
           WHERE child_id = v_child
             AND mini_league_id = v_league
             AND parent_user_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Original behaviour: mark matching invites accepted
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
$function$;
