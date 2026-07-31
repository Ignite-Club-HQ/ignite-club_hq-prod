import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subscription_type, entity_id } = await req.json();

    if (!subscription_type || !entity_id) {
      return new Response(JSON.stringify({ error: 'subscription_type and entity_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['team', 'club'].includes(subscription_type)) {
      return new Response(JSON.stringify({ error: 'subscription_type must be "team" or "club"' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let stripeSubscriptionId: string | null = null;
    let clubId: string | null = null;

    if (subscription_type === 'team') {
      const { data: team } = await supabase
        .from('teams')
        .select('id, created_by, club_id, stripe_subscription_id')
        .eq('id', entity_id)
        .single();

      if (!team) {
        return new Response(JSON.stringify({ error: 'Team not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check authorization using has_role RPC
      const { data: isTeamAdmin } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'team_admin', _club_id: null, _team_id: entity_id });
      const { data: isCoach } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'coach', _club_id: null, _team_id: entity_id });
      let isClubAdmin = false;
      if (team.club_id) {
        const { data } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'club_admin', _club_id: team.club_id, _team_id: null });
        isClubAdmin = !!data;
      }
      const { data: isAppAdmin } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'app_admin', _club_id: null, _team_id: null });

      if (!isTeamAdmin && !isCoach && !isClubAdmin && !isAppAdmin) {
        return new Response(JSON.stringify({ error: 'Not authorized' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check team_subscriptions first, fall back to teams table (legacy)
      const { data: sub } = await supabase
        .from('team_subscriptions')
        .select('stripe_subscription_id')
        .eq('team_id', entity_id)
        .maybeSingle();

      stripeSubscriptionId = sub?.stripe_subscription_id || team.stripe_subscription_id;
      clubId = team.club_id;
    } else {
      // Club subscription - check club_admin or app_admin
      const { data: isClubAdmin } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'club_admin', _club_id: entity_id, _team_id: null });
      const { data: isAppAdmin } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'app_admin', _club_id: null, _team_id: null });

      if (!isClubAdmin && !isAppAdmin) {
        return new Response(JSON.stringify({ error: 'Not authorized' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: sub } = await supabase
        .from('club_subscriptions')
        .select('stripe_subscription_id')
        .eq('club_id', entity_id)
        .maybeSingle();

      // Fall back to legacy clubs.stripe_subscription_id — some older clubs
      // (e.g. Basket Range CC) never had a club_subscriptions row created,
      // so ignoring this field left their Stripe subscription billing
      // silently after the app said "Free". See admin_alerts for history.
      let legacyClubStripeSubId: string | null = null;
      if (!sub?.stripe_subscription_id) {
        const { data: legacyClub } = await supabase
          .from('clubs')
          .select('stripe_subscription_id')
          .eq('id', entity_id)
          .maybeSingle();
        legacyClubStripeSubId = legacyClub?.stripe_subscription_id ?? null;
      }

      stripeSubscriptionId = sub?.stripe_subscription_id || legacyClubStripeSubId;
      clubId = entity_id;
    }

    // If it's an IAP subscription, skip Stripe cancellation
    if (stripeSubscriptionId && stripeSubscriptionId.startsWith('iap_')) {
      console.log('IAP subscription detected, skipping Stripe cancellation:', stripeSubscriptionId);
      return new Response(JSON.stringify({ success: true, message: 'IAP subscription - manage via App Store/Play Store' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cancel the Stripe subscription if one exists
    if (stripeSubscriptionId) {
      // Find the Stripe secret key
      let stripeSecretKey: string | null = null;

      if (clubId) {
        const { data: clubStripeConfig } = await supabase
          .from('club_stripe_configs')
          .select('stripe_secret_key, is_enabled')
          .eq('club_id', clubId)
          .eq('is_enabled', true)
          .maybeSingle();

        if (clubStripeConfig?.stripe_secret_key) {
          stripeSecretKey = clubStripeConfig.stripe_secret_key;
        }
      }

      if (!stripeSecretKey) {
        const { data: appStripeConfig } = await supabase
          .from('app_stripe_config')
          .select('stripe_secret_key, is_enabled')
          .eq('is_enabled', true)
          .maybeSingle();

        if (appStripeConfig?.stripe_secret_key) {
          stripeSecretKey = appStripeConfig.stripe_secret_key;
        }
      }

      if (!stripeSecretKey) {
        // Refuse to downgrade a club/team that still has an active Stripe
        // subscription id when we have no key to actually cancel it. Silently
        // marking it Free here is what caused Basket Range CC to keep being
        // billed for months after admins thought they'd cancelled. Raise a
        // loud admin alert and return an error so the user knows this needs
        // manual attention.
        await supabase.from('admin_alerts').insert({
          alert_type: 'stripe_cancel_blocked_no_key',
          details: {
            subscription_type, entity_id, club_id: clubId,
            stripe_subscription_id: stripeSubscriptionId,
            actor_user_id: user.id,
            note: 'Downgrade blocked: a Stripe subscription is attached but no Stripe secret key is configured. Add a Stripe key in Admin → Stripe Settings, or cancel the subscription manually in the Stripe Dashboard and clear stripe_subscription_id on the row.',
          },
        });
        return new Response(JSON.stringify({
          error: 'Cannot downgrade: a Stripe subscription is still attached to this account, but no Stripe key is configured to cancel it. Contact support so this can be cancelled without leaving you billed.',
          code: 'stripe_cancel_blocked_no_key',
        }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

      try {
        await stripe.subscriptions.cancel(stripeSubscriptionId);
        console.log('Stripe subscription cancelled:', stripeSubscriptionId);
      } catch (stripeError: any) {
        if (stripeError.code === 'resource_missing') {
          console.warn('Stripe subscription not found — likely orphan:', stripeSubscriptionId);
          await supabase.from('admin_alerts').insert({
            alert_type: 'stripe_orphan_subscription_on_cancel',
            details: {
              subscription_type, entity_id, club_id: clubId,
              stripe_subscription_id: stripeSubscriptionId,
              actor_user_id: user.id,
              note: 'Local row referenced a Stripe subscription id that Stripe did not recognise. A different live subscription may still be billing this customer.',
            },
          });
        } else {
          console.error('Stripe cancellation error:', stripeError);
          return new Response(JSON.stringify({ error: 'Failed to cancel Stripe subscription' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // IMPORTANT: keep stripe_subscription_id so the inbound
    // customer.subscription.deleted / invoice.* webhook can still resolve this
    // row for reconciliation. Nulling it here caused orphaned Stripe
    // subscriptions to silently keep billing after admins thought they had
    // cancelled. Immediately drop entitlements so the club/team falls to free
    // straight away — Pro access is gated by (is_pro && expires_at>now).
    const nowIso = new Date().toISOString();

    if (subscription_type === 'team') {
      const { data: existingSub } = await supabase
        .from('team_subscriptions')
        .select('id')
        .eq('team_id', entity_id)
        .maybeSingle();

      if (existingSub) {
        const { error: updateError } = await supabase
          .from('team_subscriptions')
          .update({
            is_pro: false,
            is_pro_football: false,
            is_trial: false,
            trial_ends_at: null,
            expires_at: nowIso,
            cancelled_at: nowIso,
          })
          .eq('team_id', entity_id);

        if (updateError) {
          console.error('Failed to update team_subscriptions:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to reset subscription' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { error: teamUpdateError } = await supabase
        .from('teams')
        .update({ is_pro: false, pro_expires_at: nowIso })
        .eq('id', entity_id);

      if (teamUpdateError) {
        console.error('Failed to update teams entitlement');
        await supabase.from('admin_alerts').insert({
          alert_type: 'local_entitlement_reconciliation_failed',
          details: { subscription_type, entity_id, club_id: clubId, stage: 'teams_fallback_update', actor_user_id: user.id },
        });
        return new Response(JSON.stringify({
          error: 'Billing was cancelled, but your account could not be fully updated. Support has been notified.',
          code: 'local_entitlement_reconciliation_failed',
        }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const { error: updateError } = await supabase
        .from('club_subscriptions')
        .update({
          is_pro: false,
          is_pro_football: false,
          expires_at: nowIso,
          cancelled_at: nowIso,
        })
        .eq('club_id', entity_id);

      if (updateError) {
        console.error('Failed to update club_subscriptions:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to reset subscription' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: clubUpdateError } = await supabase
        .from('clubs').update({ is_pro: false }).eq('id', entity_id);

      if (clubUpdateError) {
        console.error('Failed to update clubs entitlement');
        await supabase.from('admin_alerts').insert({
          alert_type: 'local_entitlement_reconciliation_failed',
          details: { subscription_type, entity_id, club_id: clubId, stage: 'clubs_fallback_update', actor_user_id: user.id },
        });
        return new Response(JSON.stringify({
          error: 'Billing was cancelled, but your account could not be fully updated. Support has been notified.',
          code: 'local_entitlement_reconciliation_failed',
        }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // If Stripe didn't recognise the local subscription id, raise an admin
    // alert — there is likely an orphan Stripe subscription still billing.
    if (stripeSubscriptionId && !stripeSubscriptionId.startsWith('iap_')) {
      // populated by the catch block above when stripe.subscriptions.cancel
      // threw resource_missing.
    }

    console.log(`${subscription_type} trial/subscription cancelled for ${entity_id} by user ${user.id}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error instanceof Error ? error.name : 'unknown');
    return new Response(JSON.stringify({
      error: 'Subscription cancellation failed',
      code: 'subscription_cancellation_failed',
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
