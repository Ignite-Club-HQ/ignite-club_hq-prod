
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pro_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pro_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
