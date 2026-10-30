-- Fix: restrict INSERT to only the authenticated user's own records
DROP POLICY "Service role can insert IAP transactions" ON public.iap_transactions;

CREATE POLICY "Users can insert own IAP transactions"
  ON public.iap_transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
