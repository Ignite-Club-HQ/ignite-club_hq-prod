// Reconcile "orphan" legacy Stripe subscriptions on clubs.
//
// Context: some older clubs (e.g. Basket Range CC) have a
// `clubs.stripe_subscription_id` set but no matching `club_subscriptions`
// row. The old cancel path only checked `club_subscriptions`, so these
// clubs went "Free" in the app while Stripe kept billing.
//
// This function scans for that shape and, for each match:
//   1. Cancels the Stripe subscription (idempotent — resource_missing is OK).
//   2. Clears `clubs.stripe_subscription_id` on success.
//   3. Writes an `admin_alerts` row with what it did.
//
// Refunds are NOT issued here — that is a business call and must be done
// manually in Stripe per club.
//
// Auth: either an app_admin JWT OR the CRON_SECRET header. If a `club_id`
// is supplied, only that club is processed (safe first-run mode).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface Body {
  club_id?: string;
  dry_run?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ---- Authorization: cron secret OR app_admin JWT ----
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedCron = Deno.env.get('CRON_SECRET');
    let authorized = false;
    let actorUserId: string | null = null;

    if (cronSecret && expectedCron && cronSecret === expectedCron) {
      authorized = true;
    } else {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: isAppAdmin } = await supabase.rpc('has_role', {
            _user_id: user.id, _role: 'app_admin', _club_id: null, _team_id: null,
          });
          if (isAppAdmin) {
            authorized = true;
            actorUserId = user.id;
          }
        }
      }
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: Body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const scopedClubId = body.club_id ?? null;
    const dryRun = body.dry_run === true;

    // ---- Find candidates ----
    let query = supabase
      .from('clubs')
      .select('id, name, stripe_subscription_id, stripe_customer_id, is_pro')
      .not('stripe_subscription_id', 'is', null);

    if (scopedClubId) query = query.eq('id', scopedClubId);

    const { data: candidates, error: candErr } = await query;
    if (candErr) throw candErr;

    const results: Array<Record<string, unknown>> = [];

    // Resolve the app-level Stripe key once — clubs with legacy fields predate
    // per-club Stripe configs, so the app config is the right key.
    const { data: appStripeConfig } = await supabase
      .from('app_stripe_config')
      .select('stripe_secret_key, is_enabled')
      .eq('is_enabled', true)
      .maybeSingle();

    for (const club of candidates ?? []) {
      const subId: string = club.stripe_subscription_id;

      // Skip IAP records — they aren't Stripe subs.
      if (subId.startsWith('iap_')) {
        results.push({ club_id: club.id, name: club.name, skipped: 'iap' });
        continue;
      }

      // Only reconcile if there is no live club_subscriptions row owning
      // this Stripe id. If a row exists, the normal code path handles it.
      const { data: ownedSub } = await supabase
        .from('club_subscriptions')
        .select('id')
        .eq('stripe_subscription_id', subId)
        .maybeSingle();

      if (ownedSub) {
        results.push({ club_id: club.id, name: club.name, skipped: 'owned_by_club_subscriptions' });
        continue;
      }

      if (dryRun) {
        results.push({ club_id: club.id, name: club.name, would_cancel: subId });
        continue;
      }

      // Prefer club-level Stripe config if one is enabled, else app config.
      let stripeSecretKey: string | null = null;
      const { data: clubStripe } = await supabase
        .from('club_stripe_configs')
        .select('stripe_secret_key, is_enabled')
        .eq('club_id', club.id)
        .eq('is_enabled', true)
        .maybeSingle();
      if (clubStripe?.stripe_secret_key) stripeSecretKey = clubStripe.stripe_secret_key;
      else if (appStripeConfig?.stripe_secret_key) stripeSecretKey = appStripeConfig.stripe_secret_key;

      if (!stripeSecretKey) {
        results.push({ club_id: club.id, name: club.name, error: 'no_stripe_key' });
        await supabase.from('admin_alerts').insert({
          alert_type: 'legacy_subscription_reconcile_no_key',
          details: { club_id: club.id, stripe_subscription_id: subId },
        });
        continue;
      }

      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

      let cancelled = false;
      let alreadyGone = false;
      let cancelError: string | null = null;
      try {
        await stripe.subscriptions.cancel(subId);
        cancelled = true;
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'resource_missing') {
          alreadyGone = true;
        } else {
          cancelError = e.message ?? 'unknown_stripe_error';
        }
      }

      if (cancelled || alreadyGone) {
        await supabase
          .from('clubs')
          .update({ stripe_subscription_id: null, is_pro: false })
          .eq('id', club.id);
      }

      await supabase.from('admin_alerts').insert({
        alert_type: cancelError
          ? 'legacy_subscription_reconcile_failed'
          : 'legacy_subscription_reconciled',
        details: {
          club_id: club.id,
          club_name: club.name,
          stripe_subscription_id: subId,
          stripe_customer_id: club.stripe_customer_id,
          cancelled,
          already_gone_in_stripe: alreadyGone,
          error: cancelError,
          actor_user_id: actorUserId,
          note: 'Reconciled by reconcile-legacy-subscriptions. Refunds (if any) must be issued manually in Stripe.',
        },
      });

      results.push({
        club_id: club.id,
        name: club.name,
        stripe_subscription_id: subId,
        cancelled,
        already_gone_in_stripe: alreadyGone,
        error: cancelError,
      });
    }

    return new Response(
      JSON.stringify({ scanned: candidates?.length ?? 0, dry_run: dryRun, results }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('reconcile-legacy-subscriptions error:', error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
