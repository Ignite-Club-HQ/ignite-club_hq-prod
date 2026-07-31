import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authoritativeEventAmountCents,
  classifyPaymentReference,
  verifyMemberPaymentRecord,
  verifyStripeCheckoutSession,
  verifyStripePaymentIntent,
  type ExpectedPaymentFacts,
  type VerificationResult,
} from "../_shared/eventPaymentVerification.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Established currency for Ignite event payments. */
const EVENT_PAYMENT_CURRENCY = 'aud';

/**
 * The Ignite payments project owns `member_payments` (the row the mobile /
 * web checkout listens to). Overridable by configuration; the publishable
 * anon key is safe to ship because the row is only ever read here.
 */
const MEMBER_PAYMENTS_URL =
  Deno.env.get('IGNITE_PAYMENTS_SUPABASE_URL') ?? 'https://frkzyniekamxudaumeaf.supabase.co';
const MEMBER_PAYMENTS_KEY =
  Deno.env.get('IGNITE_PAYMENTS_SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('IGNITE_PAYMENTS_SUPABASE_ANON_KEY') ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZya3p5bmlla2FteHVkYXVtZWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4OTc3MzQsImV4cCI6MjA4MzQ3MzczNH0.vNm-imUjO7kfcPNDf0JPSg9zzN5_AV-dkMXBgriWVyo';

type Json = Record<string, unknown>;

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Stable, non-leaking error envelope. */
function fail(code: string, status: number, message?: string): Response {
  return json({ error: message ?? 'Payment confirmation failed', code }, status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Correlation id for operational logs — never contains payment data.
  const correlationId = crypto.randomUUID();

  try {
    // 1. Authenticate BEFORE reading secrets or touching provider APIs.
    const rawAuth = req.headers.get('Authorization') ?? '';
    if (!rawAuth.startsWith('Bearer ')) {
      return fail('unauthorized', 401, 'Authorization required');
    }
    const token = rawAuth.slice('Bearer '.length).trim();
    if (!token) {
      return fail('unauthorized', 401, 'Authorization required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) {
      return fail('unauthorized', 401, 'Invalid token');
    }

    // 2. Parse input. `amount` and any status supplied by the caller are
    //    deliberately ignored — the client is never authoritative for money.
    let body: Json;
    try {
      body = await req.json();
    } catch {
      return fail('invalid_request', 400, 'Invalid request body');
    }

    const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
    const paymentRef = typeof body.payment_id === 'string' ? body.payment_id.trim() : '';
    if (!eventId || !paymentRef) {
      return fail('invalid_request', 400, 'Missing required fields: event_id, payment_id');
    }

    const referenceKind = classifyPaymentReference(paymentRef);
    if (referenceKind === 'invalid') {
      return fail('invalid_request', 400, 'Invalid payment reference');
    }

    // 3. Load the event. A lookup failure must fail closed, not 404.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, club_id, amount, type, is_cancelled')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError) {
      console.error(`[${correlationId}] event lookup failed`, eventError.code ?? 'unknown');
      return fail('event_lookup_failed', 503, 'Temporarily unable to confirm payment');
    }
    if (!event) {
      return fail('event_not_found', 404, 'Event not found');
    }

    const expectedAmountCents = authoritativeEventAmountCents(event.amount);
    if (expectedAmountCents === null || event.is_cancelled) {
      return fail('event_not_payable', 400, 'This event does not accept payment');
    }

    // 4. Authorization — membership lookup errors must not become denial or
    //    success; they are retriable failures.
    const { data: isMember, error: membershipError } = await supabase.rpc('is_club_member', {
      _user_id: user.id,
      _club_id: event.club_id,
    });

    if (membershipError) {
      console.error(`[${correlationId}] membership lookup failed`, membershipError.code ?? 'unknown');
      return fail('membership_lookup_failed', 503, 'Temporarily unable to confirm payment');
    }
    if (isMember !== true) {
      return fail('forbidden', 403, 'Not a club member');
    }

    const expected: ExpectedPaymentFacts = {
      eventId: event.id,
      userId: user.id,
      clubId: event.club_id,
      amountCents: expectedAmountCents,
      currency: EVENT_PAYMENT_CURRENCY,
    };

    // 5. Retrieve the provider object server-side and verify it.
    let verification: VerificationResult;

    if (referenceKind === 'member_payment') {
      const record = await fetchMemberPayment(paymentRef, correlationId);
      if (record.status === 'unavailable') {
        return fail('payment_lookup_failed', 503, 'Temporarily unable to confirm payment');
      }
      verification = verifyMemberPaymentRecord(record.row, expected);
    } else {
      const secret = await resolveStripeSecret(supabase, event.club_id, correlationId);
      if (secret.status === 'error') {
        return fail('payment_config_lookup_failed', 503, 'Temporarily unable to confirm payment');
      }
      if (secret.status === 'missing') {
        return fail('payment_provider_unavailable', 503, 'Temporarily unable to confirm payment');
      }

      const object = await fetchStripeObject(referenceKind, paymentRef, secret.key, correlationId);
      if (object.status === 'unavailable') {
        return fail('payment_lookup_failed', 503, 'Temporarily unable to confirm payment');
      }
      verification =
        referenceKind === 'stripe_payment_intent'
          ? verifyStripePaymentIntent(object.data, expected)
          : verifyStripeCheckoutSession(object.data, expected);
    }

    if (!verification.ok) {
      console.warn(
        `[${correlationId}] payment verification rejected: ${verification.code} (event=${eventId})`,
      );
      const status = verification.code === 'payment_not_found' ? 404 : 400;
      return fail(verification.code, status, 'Payment could not be verified');
    }

    // 6. Record atomically. Only verified, server-derived facts are written.
    const recorded = await recordVerifiedPayment(supabase, {
      eventId,
      userId: user.id,
      amount: verification.amountCents / 100,
      providerPaymentId: paymentRef,
      correlationId,
    });

    if (recorded.status === 'conflict') {
      return fail('payment_identity_conflict', 409, 'Payment could not be verified');
    }
    if (recorded.status === 'error') {
      return fail('payment_record_failed', 503, 'Temporarily unable to confirm payment');
    }

    console.log(
      `[${correlationId}] event payment confirmed (event=${eventId}, duplicate=${recorded.status === 'duplicate'})`,
    );

    return json({ success: true, already_recorded: recorded.status === 'duplicate' });
  } catch (error) {
    console.error(`[${correlationId}] unhandled confirm-event-payment failure`,
      error instanceof Error ? error.name : 'unknown');
    return fail('payment_confirmation_failed', 500);
  }
});

// ---------------------------------------------------------------------------

async function fetchMemberPayment(
  paymentId: string,
  correlationId: string,
): Promise<{ status: 'ok'; row: unknown } | { status: 'unavailable' }> {
  try {
    const res = await fetch(
      `${MEMBER_PAYMENTS_URL}/rest/v1/member_payments?id=eq.${encodeURIComponent(paymentId)}&select=*`,
      {
        headers: {
          apikey: MEMBER_PAYMENTS_KEY,
          Authorization: `Bearer ${MEMBER_PAYMENTS_KEY}`,
          Accept: 'application/json',
        },
      },
    );
    if (!res.ok) {
      console.error(`[${correlationId}] member payment lookup status ${res.status}`);
      return { status: 'unavailable' };
    }
    const rows = await res.json();
    return { status: 'ok', row: Array.isArray(rows) ? (rows[0] ?? null) : null };
  } catch {
    console.error(`[${correlationId}] member payment lookup transport failure`);
    return { status: 'unavailable' };
  }
}

async function resolveStripeSecret(
  supabase: any,
  clubId: string,
  correlationId: string,
): Promise<{ status: 'ok'; key: string } | { status: 'missing' } | { status: 'error' }> {
  const { data: clubConfig, error: clubError } = await supabase
    .from('club_stripe_configs')
    .select('stripe_secret_key, is_enabled')
    .eq('club_id', clubId)
    .maybeSingle();

  if (clubError) {
    console.error(`[${correlationId}] club stripe config lookup failed`, clubError.code ?? 'unknown');
    return { status: 'error' };
  }
  if (clubConfig?.is_enabled && clubConfig.stripe_secret_key) {
    return { status: 'ok', key: clubConfig.stripe_secret_key };
  }

  const { data: appConfig, error: appError } = await supabase
    .from('app_stripe_config')
    .select('stripe_secret_key, is_enabled')
    .eq('is_enabled', true)
    .maybeSingle();

  if (appError) {
    console.error(`[${correlationId}] app stripe config lookup failed`, appError.code ?? 'unknown');
    return { status: 'error' };
  }
  if (appConfig?.stripe_secret_key) {
    return { status: 'ok', key: appConfig.stripe_secret_key };
  }
  return { status: 'missing' };
}

async function fetchStripeObject(
  kind: 'stripe_payment_intent' | 'stripe_checkout_session',
  id: string,
  secretKey: string,
  correlationId: string,
): Promise<{ status: 'ok'; data: unknown } | { status: 'unavailable' }> {
  const path =
    kind === 'stripe_payment_intent'
      ? `payment_intents/${encodeURIComponent(id)}`
      : `checkout/sessions/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (res.status === 404) {
      return { status: 'ok', data: null };
    }
    if (!res.ok) {
      // Log only the sanitized status — never the Stripe error body.
      console.error(`[${correlationId}] stripe retrieve failed with status ${res.status}`);
      return { status: 'unavailable' };
    }
    return { status: 'ok', data: await res.json() };
  } catch {
    console.error(`[${correlationId}] stripe retrieve transport failure`);
    return { status: 'unavailable' };
  }
}

/**
 * Insert exactly once. Prefers the narrowly scoped service-role RPC
 * `record_verified_event_payment`; falls back to a conflict-aware insert while
 * that migration is pending review.
 */
async function recordVerifiedPayment(
  supabase: any,
  input: {
    eventId: string;
    userId: string;
    amount: number;
    providerPaymentId: string;
    correlationId: string;
  },
): Promise<{ status: 'inserted' | 'duplicate' | 'conflict' | 'error' }> {
  const { data, error } = await supabase.rpc('record_verified_event_payment', {
    _event_id: input.eventId,
    _user_id: input.userId,
    _amount: input.amount,
    _provider_payment_id: input.providerPaymentId,
  });

  if (!error) {
    const outcome = typeof data === 'string' ? data : data?.outcome;
    if (outcome === 'conflict') return { status: 'conflict' };
    return { status: outcome === 'duplicate' ? 'duplicate' : 'inserted' };
  }

  const missingRpc = error.code === 'PGRST202' || error.code === '42883';
  if (!missingRpc) {
    console.error(`[${input.correlationId}] payment record rpc failed`, error.code ?? 'unknown');
    return { status: 'error' };
  }

  // --- Fallback path (RPC not yet deployed) --------------------------------
  const { error: insertError } = await supabase.from('event_payments').insert({
    event_id: input.eventId,
    user_id: input.userId,
    amount: input.amount,
    payment_status: 'paid',
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: input.providerPaymentId,
  });

  if (!insertError) return { status: 'inserted' };

  // Unique violation → a concurrent/duplicate confirmation. Re-read and only
  // treat it as success when the stored row is the same payment identity.
  if (insertError.code === '23505') {
    const { data: existing, error: readError } = await supabase
      .from('event_payments')
      .select('user_id, event_id, stripe_payment_intent_id')
      .eq('event_id', input.eventId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (readError) {
      console.error(`[${input.correlationId}] duplicate re-read failed`, readError.code ?? 'unknown');
      return { status: 'error' };
    }
    if (!existing) return { status: 'conflict' };
    if (
      existing.stripe_payment_intent_id &&
      existing.stripe_payment_intent_id !== input.providerPaymentId
    ) {
      return { status: 'conflict' };
    }
    return { status: 'duplicate' };
  }

  console.error(`[${input.correlationId}] payment insert failed`, insertError.code ?? 'unknown');
  return { status: 'error' };
}
