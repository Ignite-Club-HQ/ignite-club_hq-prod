-- Add payment_type column to distinguish between subscription and uniform fees
ALTER TABLE public.member_subscription_payments 
ADD COLUMN payment_type text NOT NULL DEFAULT 'subscription';

-- Add check constraint for valid payment types
ALTER TABLE public.member_subscription_payments
ADD CONSTRAINT member_subscription_payments_payment_type_check 
CHECK (payment_type IN ('subscription', 'uniform'));

-- Update unique constraint to include payment_type (drop old, create new)
ALTER TABLE public.member_subscription_payments
DROP CONSTRAINT IF EXISTS member_subscription_payments_user_id_club_id_payment_period_key;

ALTER TABLE public.member_subscription_payments
ADD CONSTRAINT member_subscription_payments_user_club_period_type_key 
UNIQUE (user_id, club_id, payment_period, payment_type);

-- Add index for payment_type queries
CREATE INDEX idx_member_subscription_payments_type ON public.member_subscription_payments(payment_type);

-- Add comment
COMMENT ON COLUMN public.member_subscription_payments.payment_type IS 'Type of payment: subscription or uniform';