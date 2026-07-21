
DO $$
DECLARE
  v_album_id uuid;
  v_uploader uuid := 'af9a5d8a-e307-455b-a084-863c43aa937e';
  v_team uuid := '76d94b7a-baf5-4867-8015-92fe620b3a97';
  v_club uuid := '966bdaec-ebf1-46da-b2b3-cc53bf05c422';
BEGIN
  INSERT INTO public.photo_albums (uploader_id, club_id, team_id, caption, created_at)
  VALUES (v_uploader, v_club, v_team, NULL, '2026-05-16 04:47:00+00')
  RETURNING id INTO v_album_id;

  UPDATE public.photos
  SET album_id = v_album_id
  WHERE album_id IS NULL
    AND uploader_id = v_uploader
    AND team_id = v_team
    AND created_at >= '2026-05-16 04:47:00+00'
    AND created_at <  '2026-05-16 04:49:00+00';
END $$;
