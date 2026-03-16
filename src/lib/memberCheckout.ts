import { createClient } from '@supabase/supabase-js';

// Second Supabase client pointing to the Ignite website project
// Used for Realtime listening on member_payments table
const WEBSITE_SUPABASE_URL = 'https://frkzyniekamxudaumeaf.supabase.co';
const WEBSITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZya3p5bmlla2FteHVkYXVtZWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4OTc3MzQsImV4cCI6MjA4MzQ3MzczNH0.vNm-imUjO7kfcPNDf0JPSg9zzN5_AV-dkMXBgriWVyo';

export const websiteSupabase = createClient(WEBSITE_SUPABASE_URL, WEBSITE_SUPABASE_ANON_KEY);

export const IGNITE_PLATFORM_FEE_PERCENT = 0.05; // 5%

export interface MemberCheckoutParams {
  club_id: string;
  title: string;
  amount_cents: number; // e.g. 2500 = $25.00, minimum 50
  type: 'event' | 'subscription';
  currency?: string; // defaults to 'aud'
  payer_email?: string;
  payer_name?: string;
  description?: string;
  interval?: 'week' | 'month' | 'year'; // required when type='subscription'
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, string>;
  platform_fee_cents?: number; // Ignite platform fee (5%)
}

export interface MemberCheckoutResponse {
  url: string;
  payment_id: string;
  error?: string;
}

/**
 * Call the website project's edge function to create a Stripe Checkout session.
 * No auth token needed — the edge function is public and validates via club config.
 */
export async function createMemberCheckout(
  params: MemberCheckoutParams
): Promise<MemberCheckoutResponse> {
  const platformFeeCents = Math.round(params.amount_cents * IGNITE_PLATFORM_FEE_PERCENT);

  const body: MemberCheckoutParams = {
    ...params,
    currency: params.currency ?? 'aud',
    success_url: params.success_url ?? 'igniteclubhq://payment-success',
    cancel_url: params.cancel_url ?? 'igniteclubhq://payment-cancel',
    platform_fee_cents: platformFeeCents,
    metadata: {
      ...params.metadata,
      platform_fee_cents: platformFeeCents.toString(),
    },
  };

  const res = await fetch(
    `${WEBSITE_SUPABASE_URL}/functions/v1/create-member-checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  return res.json();
}

/**
 * Subscribe to Realtime changes on a member_payments row.
 * Resolves when payment status becomes 'paid' or 'failed'.
 * Auto-unsubscribes after resolution or timeout.
 */
export function listenForPaymentStatus(
  paymentId: string,
  onStatusChange: (status: 'paid' | 'failed', payload: any) => void,
  timeoutMs = 10 * 60 * 1000 // 10 minutes default
): () => void {
  const channel = websiteSupabase
    .channel(`payment-${paymentId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'member_payments',
        filter: `id=eq.${paymentId}`,
      },
      (payload) => {
        const status = (payload.new as any)?.status;
        if (status === 'paid' || status === 'failed') {
          onStatusChange(status, payload.new);
          cleanup();
        }
      }
    )
    .subscribe();

  const timer = setTimeout(() => {
    cleanup();
  }, timeoutMs);

  function cleanup() {
    clearTimeout(timer);
    websiteSupabase.removeChannel(channel);
  }

  return cleanup;
}
