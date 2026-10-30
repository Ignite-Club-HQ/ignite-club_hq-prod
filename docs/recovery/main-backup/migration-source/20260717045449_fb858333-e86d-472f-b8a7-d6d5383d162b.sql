
ALTER TABLE public.photos DISABLE TRIGGER enforce_photo_storage_prefix_trigger;

DO $$ BEGIN
  -- no-op if trigger already disabled/not exists
EXCEPTION WHEN OTHERS THEN NULL; END $$;

INSERT INTO public.photos (club_id, team_id, uploader_id, image_url, title, caption, show_in_feed, created_at)
VALUES
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200', 'Match day atmosphere', 'Packed sidelines for the Saturday derby', true, now() - interval '2 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200', 'Sunset training', 'Golden hour on the main pitch', true, now() - interval '4 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200', 'Ball skills clinic', 'Volunteer coaches leading a skills session', true, now() - interval '6 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?w=1200', 'Season kickoff BBQ', 'Families gathered at the clubhouse', true, now() - interval '8 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1552667466-07770ae110d0?w=1200', 'Under lights', 'Friday night fixtures', true, now() - interval '10 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', NULL, 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1200', 'Presentation night', 'Awards handed out to top performers', true, now() - interval '14 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '2a8f1436-9be3-419c-a545-f948afc6739b', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1526232373132-0e4ee643fa17?w=1200', 'First game of the season', 'Big smiles all round', true, now() - interval '3 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '2a8f1436-9be3-419c-a545-f948afc6739b', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1518604666860-9ed391f76460?w=1200', 'Team huddle', 'Half-time pep talk', true, now() - interval '5 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '2a8f1436-9be3-419c-a545-f948afc6739b', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200', 'Warm-up drills', 'Ready for kickoff', true, now() - interval '9 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1459865264687-595d652de67e?w=1200', 'Goal celebration', 'Opening goal of the match', true, now() - interval '2 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1543351611-58f69d7c1781?w=1200', 'Defensive drills', 'Working on shape', true, now() - interval '7 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=1200', 'Tournament winners', 'Regional cup champions', true, now() - interval '12 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1600679472233-8ee0adfe2eba?w=1200', 'Squad photo', 'Full team lineup', true, now() - interval '15 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '0715a270-5693-4409-9455-97e257efc019', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1551958219-acbc608c6377?w=1200', 'Match action', 'Contest for the ball in midfield', true, now() - interval '1 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '0715a270-5693-4409-9455-97e257efc019', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1200', 'Award night', 'Player of the year presentation', true, now() - interval '6 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '0715a270-5693-4409-9455-97e257efc019', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200', 'Corner kick', 'Set piece opportunity', true, now() - interval '11 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '0715a270-5693-4409-9455-97e257efc019', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200', 'Skills session', 'Midweek training', true, now() - interval '13 days'),
('36231b76-5313-478e-b8d5-23ac4f5e8b10', '0715a270-5693-4409-9455-97e257efc019', 'a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200', 'Post-match snacks', 'Fuelling up after the win', true, now() - interval '16 days');

ALTER TABLE public.photos ENABLE TRIGGER enforce_photo_storage_prefix_trigger;
