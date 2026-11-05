DO $$
DECLARE
  v_club_id uuid := '966bdaec-ebf1-46da-b2b3-cc53bf05c422';
  v_louie uuid := 'a0ed1721-0c0a-4716-952b-97fb914612f8';
  v_teddy uuid := '8d7c67ed-3488-4ad6-9d15-89c1409a9e5c';
  v_winnie uuid := '778cc5f0-1b77-441f-9cc7-35a50e5a7196';
  v_pts int := 5;
  v_louie_base int;
  v_teddy_base int;
  v_winnie_base int;
BEGIN
  SELECT ignite_points - (4 * v_pts) INTO v_louie_base FROM children WHERE id = v_louie;
  SELECT ignite_points - (1 * v_pts) INTO v_teddy_base FROM children WHERE id = v_teddy;
  SELECT ignite_points - (1 * v_pts) INTO v_winnie_base FROM children WHERE id = v_winnie;

  INSERT INTO public.points_history
    (user_id, child_id, club_id, amount, balance_after, source_type, source_id, description, created_at)
  VALUES
    (NULL, v_louie, v_club_id, v_pts, v_louie_base + 5,  'early_rsvp', 'bdad0fe1-07cb-4bde-bfda-70e3c7df4be2'::uuid, 'Early RSVP bonus (5 days before event)',  '2026-05-02 06:03:48+00'),
    (NULL, v_louie, v_club_id, v_pts, v_louie_base + 10, 'early_rsvp', 'c8e16bd0-e2be-4802-8762-17ae3de94ce1'::uuid, 'Early RSVP bonus (12 days before event)', '2026-05-02 06:05:48+00'),
    (NULL, v_louie, v_club_id, v_pts, v_louie_base + 15, 'early_rsvp', '47a55aa0-f0d6-4449-bb50-cc019eb8cfdf'::uuid, 'Early RSVP bonus (21 days before event)', '2026-05-02 06:06:34+00'),
    (NULL, v_louie, v_club_id, v_pts, v_louie_base + 20, 'early_rsvp', 'dcc8015a-fd28-4fb8-8ef0-0d613d317728'::uuid, 'Early RSVP bonus (13 days before event)', '2026-05-02 06:06:49+00'),
    (NULL, v_teddy, v_club_id, v_pts, v_teddy_base + 5,  'early_rsvp', 'a1282a4d-4b66-420d-a4de-53e7a340e13d'::uuid, 'Early RSVP bonus (13 days before event)', '2026-05-02 06:07:44+00'),
    (NULL, v_winnie, v_club_id, v_pts, v_winnie_base + 5, 'early_rsvp', 'f5f42fa0-539a-4d58-80ee-455ce9d17c4a'::uuid, 'Early RSVP bonus (11 days before event)', '2026-05-02 06:05:11+00');
END $$;