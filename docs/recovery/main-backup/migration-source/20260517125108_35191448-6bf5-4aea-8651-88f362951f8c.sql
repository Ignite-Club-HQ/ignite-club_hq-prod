ALTER TABLE public.teams ALTER COLUMN auto_rsvp_dm_enabled SET DEFAULT false;
UPDATE public.teams SET auto_rsvp_dm_enabled = false WHERE auto_rsvp_dm_enabled = true;