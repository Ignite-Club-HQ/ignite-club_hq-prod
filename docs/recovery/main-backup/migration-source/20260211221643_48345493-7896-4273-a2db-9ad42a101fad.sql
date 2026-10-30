-- Create IAP transactions table for tracking in-app purchases
CREATE TABLE public.iap_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT,
  product_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  entity_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('club', 'team')),
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.iap_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own transactions
CREATE POLICY "Users can view own IAP transactions"
  ON public.iap_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert (via edge function)
CREATE POLICY "Service role can insert IAP transactions"
  ON public.iap_transactions
  FOR INSERT
  WITH CHECK (true);

-- Index for duplicate detection
CREATE INDEX idx_iap_transactions_transaction_id ON public.iap_transactions (transaction_id);
CREATE INDEX idx_iap_transactions_user_id ON public.iap_transactions (user_id);
