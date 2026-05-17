
DO $$
DECLARE
  v_org_club uuid := '966bdaec-ebf1-46da-b2b3-cc53bf05c422'; -- Bridgewater Soccer Club
  v_creator  uuid := 'a37b4b18-159b-4ab3-90ad-48eb85456d0d'; -- reviewer@test.com
  v_focal    uuid := '2114ec92-cf1d-49fa-853b-2ffe21bda2d2'; -- U12 White
  v_t2       uuid := '1b68ffbf-0129-4c78-96a5-41fb0cb6ac96'; -- U12 Girls
  v_t3       uuid := 'c5ae51a5-0259-4927-940b-4d36285dbb05'; -- U11 Blue
  v_t4       uuid := '2a28bdb5-bda9-4cb6-8d7c-542af8ff8518'; -- U11 White
  v_comp     uuid;
  v_div      uuid;
BEGIN
  -- Avoid duplicates if rerun
  SELECT id INTO v_comp FROM public.competitions
    WHERE name = 'Demo Winter League 2026' AND organizer_club_id = v_org_club;

  IF v_comp IS NULL THEN
    INSERT INTO public.competitions
      (organizer_club_id, name, sport, description, season, starts_on, ends_on,
       status, visibility, created_by, points_win, points_draw, points_loss)
    VALUES
      (v_org_club, 'Demo Winter League 2026', 'Football (Soccer)',
       'Demo competition for App Store reviewers. Includes a populated ladder and recent fixtures across U11/U12 teams.',
       '2026', CURRENT_DATE - INTERVAL '28 days', CURRENT_DATE + INTERVAL '28 days',
       'active', 'public', v_creator, 3, 1, 0)
    RETURNING id INTO v_comp;
  END IF;

  -- Division
  SELECT id INTO v_div FROM public.competition_divisions
    WHERE competition_id = v_comp AND name = 'U12 Mixed';
  IF v_div IS NULL THEN
    INSERT INTO public.competition_divisions
      (competition_id, name, age_group, sort_order, hide_ladder)
    VALUES (v_comp, 'U12 Mixed', 'U12', 0, false)
    RETURNING id INTO v_div;
  END IF;

  -- Entries (accepted)
  INSERT INTO public.competition_entries (competition_id, division_id, team_id, status, invited_by, responded_by, responded_at)
  SELECT v_comp, v_div, t, 'accepted', v_creator, v_creator, now()
  FROM unnest(ARRAY[v_focal, v_t2, v_t3, v_t4]) AS t
  ON CONFLICT DO NOTHING;

  -- Reviewer as competition admin
  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (v_comp, v_creator, 'admin')
  ON CONFLICT DO NOTHING;

  -- Wipe & seed matches (idempotent re-seed)
  DELETE FROM public.competition_matches WHERE competition_id = v_comp;

  -- Round 1 (played)
  INSERT INTO public.competition_matches
    (competition_id, division_id, round_number, home_team_id, away_team_id, scheduled_at, venue, status, home_score, away_score, created_by)
  VALUES
    (v_comp, v_div, 1, v_focal, v_t2, now() - INTERVAL '21 days', 'Bridgewater Oval', 'completed', 3, 1, v_creator),
    (v_comp, v_div, 1, v_t3,    v_t4, now() - INTERVAL '21 days', 'Bridgewater Oval', 'completed', 2, 2, v_creator),
  -- Round 2 (played)
    (v_comp, v_div, 2, v_t2,    v_t3, now() - INTERVAL '14 days', 'Bridgewater Oval', 'completed', 0, 4, v_creator),
    (v_comp, v_div, 2, v_t4,    v_focal, now() - INTERVAL '14 days', 'Bridgewater Oval', 'completed', 1, 2, v_creator),
  -- Round 3 (played)
    (v_comp, v_div, 3, v_focal, v_t3, now() - INTERVAL '7 days', 'Bridgewater Oval', 'completed', 1, 1, v_creator),
    (v_comp, v_div, 3, v_t2,    v_t4, now() - INTERVAL '7 days', 'Bridgewater Oval', 'completed', 2, 0, v_creator),
  -- Round 4 (upcoming)
    (v_comp, v_div, 4, v_t3,    v_focal, now() + INTERVAL '7 days', 'Bridgewater Oval', 'scheduled', NULL, NULL, v_creator),
    (v_comp, v_div, 4, v_t4,    v_t2, now() + INTERVAL '7 days', 'Bridgewater Oval', 'scheduled', NULL, NULL, v_creator);
END $$;
