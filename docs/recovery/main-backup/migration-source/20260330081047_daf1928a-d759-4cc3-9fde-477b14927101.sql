
ALTER TABLE public.team_messages
  ADD COLUMN is_club_announcement boolean NOT NULL DEFAULT false,
  ADD COLUMN club_announcement_name text;
