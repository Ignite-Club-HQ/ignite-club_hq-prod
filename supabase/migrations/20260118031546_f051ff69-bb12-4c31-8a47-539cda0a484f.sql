-- Add unique constraint for club names (case-insensitive)
CREATE UNIQUE INDEX idx_unique_club_name ON public.clubs (lower(name));