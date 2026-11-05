ALTER TABLE public.events ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_competition_id ON public.events(competition_id) WHERE competition_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_competition_event(
  p_competition_id uuid,
  p_title text,
  p_type public.event_type,
  p_event_date timestamptz,
  p_location text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  r RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.is_competition_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'Not allowed to create events for this competition' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF p_event_date IS NULL THEN
    RAISE EXCEPTION 'Date and time are required';
  END IF;

  FOR r IN
    SELECT DISTINCT t.id AS team_id, t.club_id
    FROM public.competition_entries ce
    JOIN public.teams t ON t.id = ce.team_id
    WHERE ce.competition_id = p_competition_id
      AND ce.status = 'accepted'
      AND t.club_id IS NOT NULL
  LOOP
    INSERT INTO public.events (club_id, team_id, title, description, event_date, end_time,
                               location, location_name, type, created_by, competition_id, reminder_hours_before)
    VALUES (r.club_id, r.team_id, btrim(p_title), NULLIF(btrim(COALESCE(p_description,'')),''),
            p_event_date, p_end_time,
            NULLIF(btrim(COALESCE(p_location,'')),''),
            NULLIF(split_part(btrim(COALESCE(p_location,'')), ',', 1),''),
            p_type, v_uid, p_competition_id, 24);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_competition_event(uuid,text,public.event_type,timestamptz,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_competition_event(uuid,text,public.event_type,timestamptz,text,text,timestamptz) TO authenticated;