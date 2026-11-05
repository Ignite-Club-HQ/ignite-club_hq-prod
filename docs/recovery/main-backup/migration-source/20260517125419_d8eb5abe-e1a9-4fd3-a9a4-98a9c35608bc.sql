ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS auto_rsvp_dm_cadences text[] NOT NULL DEFAULT ARRAY['t72','t24','t3']::text[],
  ADD COLUMN IF NOT EXISTS auto_rsvp_dm_event_types text[] NOT NULL DEFAULT ARRAY['match','training','game']::text[];