CREATE OR REPLACE FUNCTION public.validate_event_target_team_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arr_len int;
  distinct_len int;
  bad_count int;
BEGIN
  IF NEW.target_team_ids IS NULL THEN
    RETURN NEW;
  END IF;

  arr_len := COALESCE(array_length(NEW.target_team_ids, 1), 0);

  IF arr_len = 0 THEN
    RAISE EXCEPTION 'target_team_ids must contain at least 2 teams (received empty array)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF arr_len < 2 THEN
    RAISE EXCEPTION 'target_team_ids must contain at least 2 teams — use events.team_id for a single team'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(DISTINCT tid) INTO distinct_len
    FROM unnest(NEW.target_team_ids) AS tid;
  IF distinct_len <> arr_len THEN
    RAISE EXCEPTION 'target_team_ids must not contain duplicate team ids'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'target_team_ids can only be set on club-wide events (team_id must be null)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type NOT IN ('game','social','training') THEN
    RAISE EXCEPTION 'target_team_ids is only supported for game, social or training events'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.club_id IS NULL THEN
    RAISE EXCEPTION 'target_team_ids requires a club_id'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO bad_count
  FROM unnest(NEW.target_team_ids) AS tid
  LEFT JOIN public.teams t ON t.id = tid
  WHERE t.id IS NULL OR t.club_id <> NEW.club_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'target_team_ids contains teams that do not belong to the event club'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;