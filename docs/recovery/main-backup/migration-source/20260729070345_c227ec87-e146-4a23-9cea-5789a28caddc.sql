CREATE OR REPLACE FUNCTION public.duplicate_season_structure(_source_season_id uuid, _new_season_name text, _copy_staff boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _club_id UUID;
  _new_season_id UUID;
  _team_rec RECORD;
  _new_team_id UUID;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _source_season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Source season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can create seasons';
  END IF;

  INSERT INTO public.seasons (club_id, name, status, created_by)
  VALUES (_club_id, _new_season_name, 'draft', auth.uid())
  RETURNING id INTO _new_season_id;

  FOR _team_rec IN
    SELECT id, name, level_age, team_type, club_id, default_pitch_format, default_formation
    FROM public.teams
    WHERE season_id = _source_season_id
      AND deleted_at IS NULL
      AND club_id = _club_id
    ORDER BY created_at
  LOOP
    INSERT INTO public.teams (
      club_id, name, level_age, team_type, season_id, lifecycle_status,
      is_archived, archived_at, deleted_at,
      default_pitch_format, default_formation, created_by
    )
    VALUES (
      _club_id, _team_rec.name, _team_rec.level_age, _team_rec.team_type,
      _new_season_id, 'draft',
      false, NULL, NULL,
      _team_rec.default_pitch_format, _team_rec.default_formation, auth.uid()
    )
    RETURNING id INTO _new_team_id;

    IF _copy_staff THEN
      INSERT INTO public.user_roles (user_id, role, team_id, club_id)
      SELECT DISTINCT user_id, role, _new_team_id, _club_id
      FROM public.user_roles
      WHERE team_id = _team_rec.id
        AND role IN ('team_admin', 'coach')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN _new_season_id;
END;
$function$;