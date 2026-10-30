
-- ============================================================
-- 1. Create two class-mode demo clubs
-- ============================================================

-- Swimming Academy
INSERT INTO public.clubs (id, name, sport, class_mode_enabled, created_by)
VALUES (
  'a1b2c3d4-0001-4000-8000-000000000001',
  'Aqua Swim Academy',
  'Swimming',
  true,
  'a37b4b18-159b-4ab3-90ad-48eb85456d0d'
);

-- Dance Studio
INSERT INTO public.clubs (id, name, sport, class_mode_enabled, created_by)
VALUES (
  'a1b2c3d4-0002-4000-8000-000000000002',
  'Rhythm Dance Studio',
  'Dance',
  true,
  'a37b4b18-159b-4ab3-90ad-48eb85456d0d'
);

-- ============================================================
-- 2. Give reviewer club_admin role on both new clubs
-- ============================================================

INSERT INTO public.user_roles (user_id, club_id, role)
VALUES
  ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'a1b2c3d4-0001-4000-8000-000000000001', 'club_admin'),
  ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'a1b2c3d4-0002-4000-8000-000000000002', 'club_admin');

-- ============================================================
-- 3. Create terms for both clubs
-- ============================================================

-- Swim Academy terms
INSERT INTO public.terms (id, club_id, name, start_date, end_date, is_active)
VALUES
  ('b1b2c3d4-0001-4000-8000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000001', 'Term 1 2026', '2026-01-19', '2026-04-10', true),
  ('b1b2c3d4-0002-4000-8000-000000000002', 'a1b2c3d4-0001-4000-8000-000000000001', 'Term 2 2026', '2026-04-27', '2026-07-03', true);

-- Dance Studio terms
INSERT INTO public.terms (id, club_id, name, start_date, end_date, is_active)
VALUES
  ('b1b2c3d4-0003-4000-8000-000000000003', 'a1b2c3d4-0002-4000-8000-000000000002', 'Term 1 2026', '2026-01-19', '2026-04-10', true),
  ('b1b2c3d4-0004-4000-8000-000000000004', 'a1b2c3d4-0002-4000-8000-000000000002', 'Term 2 2026', '2026-04-27', '2026-07-03', true);

-- ============================================================
-- 4. Create classes (teams with class fields) for Swim Academy
-- ============================================================

INSERT INTO public.teams (id, name, club_id, class_day, class_time, class_duration_minutes, class_capacity, level_age)
VALUES
  ('c1b2c3d4-0001-4000-8000-000000000001', 'Learn to Swim - Beginners', 'a1b2c3d4-0001-4000-8000-000000000001', 'Monday', '09:00', 45, 12, 'Ages 4-6'),
  ('c1b2c3d4-0002-4000-8000-000000000002', 'Learn to Swim - Intermediate', 'a1b2c3d4-0001-4000-8000-000000000001', 'Monday', '10:00', 45, 10, 'Ages 6-8'),
  ('c1b2c3d4-0003-4000-8000-000000000003', 'Squad Training', 'a1b2c3d4-0001-4000-8000-000000000001', 'Wednesday', '16:00', 60, 8, 'Ages 8-12'),
  ('c1b2c3d4-0004-4000-8000-000000000004', 'Water Safety', 'a1b2c3d4-0001-4000-8000-000000000001', 'Saturday', '09:00', 30, 15, 'All Ages');

-- ============================================================
-- 5. Create classes for Dance Studio
-- ============================================================

INSERT INTO public.teams (id, name, club_id, class_day, class_time, class_duration_minutes, class_capacity, level_age)
VALUES
  ('c1b2c3d4-0005-4000-8000-000000000005', 'Ballet - Beginners', 'a1b2c3d4-0002-4000-8000-000000000002', 'Tuesday', '15:30', 45, 12, 'Ages 3-5'),
  ('c1b2c3d4-0006-4000-8000-000000000006', 'Hip Hop Kids', 'a1b2c3d4-0002-4000-8000-000000000002', 'Tuesday', '16:30', 60, 15, 'Ages 6-10'),
  ('c1b2c3d4-0007-4000-8000-000000000007', 'Contemporary Jazz', 'a1b2c3d4-0002-4000-8000-000000000002', 'Thursday', '17:00', 60, 10, 'Ages 10-14'),
  ('c1b2c3d4-0008-4000-8000-000000000008', 'Tiny Dancers', 'a1b2c3d4-0002-4000-8000-000000000002', 'Saturday', '10:00', 30, 20, 'Ages 2-4');

-- ============================================================
-- 6. Create mini league for Riverside FC
-- ============================================================

INSERT INTO public.mini_leagues (id, name, club_id, created_by)
VALUES (
  'd1b2c3d4-0001-4000-8000-000000000001',
  'U10 Development League',
  '36231b76-5313-478e-b8d5-23ac4f5e8b10',
  'a37b4b18-159b-4ab3-90ad-48eb85456d0d'
);

-- Give reviewer league_admin role
INSERT INTO public.user_roles (user_id, club_id, role)
VALUES ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', '36231b76-5313-478e-b8d5-23ac4f5e8b10', 'league_admin')
ON CONFLICT DO NOTHING;
