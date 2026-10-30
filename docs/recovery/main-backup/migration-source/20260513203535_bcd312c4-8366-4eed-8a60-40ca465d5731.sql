
CREATE OR REPLACE FUNCTION public.create_photo_album(
  _club_id uuid,
  _team_id uuid,
  _mini_league_id uuid,
  _event_id uuid,
  _caption text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.photo_albums (uploader_id, club_id, team_id, mini_league_id, event_id, caption)
  VALUES (auth.uid(), _club_id, _team_id, _mini_league_id, _event_id, _caption)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_photo_album(uuid, uuid, uuid, uuid, text) TO authenticated;
