-- Per-team default for who is prompted to RSVP
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS default_rsvp_audience text NOT NULL DEFAULT 'players_only';

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_default_rsvp_audience_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_default_rsvp_audience_check
  CHECK (default_rsvp_audience IN ('players_only','players_and_parents','parents_only'));

-- Per-event override (NULL = inherit from team default)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_audience text;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_rsvp_audience_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_rsvp_audience_check
  CHECK (rsvp_audience IS NULL OR rsvp_audience IN ('players_only','players_and_parents','parents_only'));

COMMENT ON COLUMN public.teams.default_rsvp_audience IS
  'Default audience for whose RSVP is prompted on this team''s events. One of players_only, players_and_parents, parents_only.';

COMMENT ON COLUMN public.events.rsvp_audience IS
  'Per-event override of teams.default_rsvp_audience. NULL means inherit team default.';