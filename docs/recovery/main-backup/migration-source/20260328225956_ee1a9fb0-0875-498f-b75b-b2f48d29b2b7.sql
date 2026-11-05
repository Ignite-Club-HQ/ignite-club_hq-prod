-- Add child_id column to member_subscription_payments for tracking child player payments
ALTER TABLE public.member_subscription_payments 
ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.children(id) ON DELETE CASCADE;

-- Add marked_by column if not exists
ALTER TABLE public.member_subscription_payments 
ADD COLUMN IF NOT EXISTS marked_by uuid;

-- Create new unique index that supports both user-level and child-level payments
CREATE UNIQUE INDEX IF NOT EXISTS member_subscription_payments_unique_period_v2
ON public.member_subscription_payments (user_id, club_id, payment_period, payment_type, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid));