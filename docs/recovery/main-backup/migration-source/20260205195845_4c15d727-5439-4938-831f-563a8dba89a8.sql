-- Add column to track if early RSVP points were awarded
ALTER TABLE public.rsvps 
ADD COLUMN early_rsvp_points_awarded BOOLEAN NOT NULL DEFAULT false;