-- Allow invited_user_id to be NULL (for invites where user hasn't signed up yet)
ALTER TABLE public.pending_invites ALTER COLUMN invited_user_id DROP NOT NULL;