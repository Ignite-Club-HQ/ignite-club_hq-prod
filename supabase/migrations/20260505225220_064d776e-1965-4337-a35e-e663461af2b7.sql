UPDATE public.club_subscriptions
SET is_trial = false,
    expires_at = trial_ends_at + interval '1 month',
    activated_at = trial_ends_at,
    updated_at = now()
WHERE club_id = '493ee2e3-c834-487d-93be-d1c8a0dbc4a8'
  AND is_trial = true;