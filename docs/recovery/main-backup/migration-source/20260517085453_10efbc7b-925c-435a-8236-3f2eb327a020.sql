
DO $$
DECLARE
  v_reviewer uuid := 'a37b4b18-159b-4ab3-90ad-48eb85456d0d';
  v_hoops_club uuid := 'fd3f2f48-6e4d-4196-ae28-2163789a5ba6';
  v_org_club uuid;
  v_focal uuid := '080d99fa-6aa9-4089-8580-2d834e4338ae'; -- Hoops U12 Eagles
  v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_comp uuid; v_div uuid;
  v_old_comp uuid;
BEGIN
  -- Wipe previous Bridgewater-seeded demo competition
  SELECT id INTO v_old_comp FROM public.competitions
    WHERE name = 'Demo Winter League 2026'
      AND organizer_club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422';
  IF v_old_comp IS NOT NULL THEN
    DELETE FROM public.competition_matches WHERE competition_id = v_old_comp;
    DELETE FROM public.competition_entries WHERE competition_id = v_old_comp;
    DELETE FROM public.competition_divisions WHERE competition_id = v_old_comp;
    DELETE FROM public.competition_roles WHERE competition_id = v_old_comp;
    DELETE FROM public.competitions WHERE id = v_old_comp;
  END IF;

  -- Demo organiser shell club
  SELECT id INTO v_org_club FROM public.clubs WHERE name = 'Demo Basketball League' AND kind = 'shell';
  IF v_org_club IS NULL THEN
    INSERT INTO public.clubs (name, kind, sport, created_by)
    VALUES ('Demo Basketball League', 'shell', 'basketball', v_reviewer)
    RETURNING id INTO v_org_club;
  END IF;

  -- Demo opponent teams (idempotent by name within shell club)
  SELECT id INTO v_t2 FROM public.teams WHERE club_id = v_org_club AND name = 'Demo Lightning';
  IF v_t2 IS NULL THEN
    INSERT INTO public.teams (club_id, name, created_by) VALUES (v_org_club, 'Demo Lightning', v_reviewer) RETURNING id INTO v_t2;
  END IF;
  SELECT id INTO v_t3 FROM public.teams WHERE club_id = v_org_club AND name = 'Demo Sharks';
  IF v_t3 IS NULL THEN
    INSERT INTO public.teams (club_id, name, created_by) VALUES (v_org_club, 'Demo Sharks', v_reviewer) RETURNING id INTO v_t3;
  END IF;
  SELECT id INTO v_t4 FROM public.teams WHERE club_id = v_org_club AND name = 'Demo Wolves';
  IF v_t4 IS NULL THEN
    INSERT INTO public.teams (club_id, name, created_by) VALUES (v_org_club, 'Demo Wolves', v_reviewer) RETURNING id INTO v_t4;
  END IF;

  -- Competition
  SELECT id INTO v_comp FROM public.competitions
    WHERE name = 'Demo U12 Basketball League 2026' AND organizer_club_id = v_org_club;
  IF v_comp IS NULL THEN
    INSERT INTO public.competitions
      (organizer_club_id, name, sport, description, season, starts_on, ends_on,
       status, visibility, created_by, points_win, points_draw, points_loss)
    VALUES
      (v_org_club, 'Demo U12 Basketball League 2026', 'basketball',
       'Demo competition for App Store reviewers. Populated ladder, recent results and upcoming fixtures across demo U12 basketball teams.',
       '2026', CURRENT_DATE - INTERVAL '28 days', CURRENT_DATE + INTERVAL '28 days',
       'active', 'public', v_reviewer, 2, 1, 0)
    RETURNING id INTO v_comp;
  END IF;

  -- Division
  SELECT id INTO v_div FROM public.competition_divisions WHERE competition_id = v_comp AND name = 'U12 Mixed';
  IF v_div IS NULL THEN
    INSERT INTO public.competition_divisions (competition_id, name, age_group, sort_order, hide_ladder)
    VALUES (v_comp, 'U12 Mixed', 'U12', 0, false)
    RETURNING id INTO v_div;
  END IF;

  -- Entries
  INSERT INTO public.competition_entries (competition_id, division_id, team_id, status, invited_by, responded_by, responded_at)
  SELECT v_comp, v_div, t, 'accepted', v_reviewer, v_reviewer, now()
  FROM unnest(ARRAY[v_focal, v_t2, v_t3, v_t4]) AS t
  ON CONFLICT DO NOTHING;

  -- Reviewer as admin
  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (v_comp, v_reviewer, 'admin')
  ON CONFLICT DO NOTHING;

  -- Reseed matches
  DELETE FROM public.competition_matches WHERE competition_id = v_comp;

  INSERT INTO public.competition_matches
    (competition_id, division_id, round_number, home_team_id, away_team_id, scheduled_at, venue, status, home_score, away_score, created_by)
  VALUES
    (v_comp, v_div, 1, v_focal, v_t2, now() - INTERVAL '21 days', 'Demo Stadium Court 1', 'completed', 42, 35, v_reviewer),
    (v_comp, v_div, 1, v_t3,    v_t4, now() - INTERVAL '21 days', 'Demo Stadium Court 2', 'completed', 28, 28, v_reviewer),
    (v_comp, v_div, 2, v_t2,    v_t3, now() - INTERVAL '14 days', 'Demo Stadium Court 1', 'completed', 31, 45, v_reviewer),
    (v_comp, v_div, 2, v_t4,    v_focal, now() - INTERVAL '14 days', 'Demo Stadium Court 2', 'completed', 22, 38, v_reviewer),
    (v_comp, v_div, 3, v_focal, v_t3, now() - INTERVAL '7 days', 'Demo Stadium Court 1', 'completed', 33, 33, v_reviewer),
    (v_comp, v_div, 3, v_t2,    v_t4, now() - INTERVAL '7 days', 'Demo Stadium Court 2', 'completed', 40, 25, v_reviewer),
    (v_comp, v_div, 4, v_t3,    v_focal, now() + INTERVAL '7 days', 'Demo Stadium Court 1', 'scheduled', NULL, NULL, v_reviewer),
    (v_comp, v_div, 4, v_t4,    v_t2, now() + INTERVAL '7 days', 'Demo Stadium Court 2', 'scheduled', NULL, NULL, v_reviewer);
END $$;
