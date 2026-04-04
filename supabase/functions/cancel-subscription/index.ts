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
        .select('id, created_by, club_id')
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

      const { data: sub } = await supabase
        .from('team_subscriptions')
        .select('stripe_subscription_id')
        .eq('team_id', entity_id)
        .single();

      stripeSubscriptionId = sub?.stripe_subscription_id;
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
        .single();

      stripeSubscriptionId = sub?.stripe_subscription_id;
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

      if (stripeSecretKey) {
        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

        try {
          await stripe.subscriptions.cancel(stripeSubscriptionId);
          console.log('Stripe subscription cancelled:', stripeSubscriptionId);
        } catch (stripeError: any) {
          // If already cancelled or not found, that's fine
          if (stripeError.code === 'resource_missing') {
            console.log('Stripe subscription already cancelled or not found:', stripeSubscriptionId);
          } else {
            console.error('Stripe cancellation error:', stripeError);
            return new Response(JSON.stringify({ error: 'Failed to cancel Stripe subscription' }), {
              status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } else {
        console.warn('No Stripe secret key found, skipping Stripe cancellation');
      }
    }

    // Clear the Stripe subscription ID so it won't auto-renew, but keep trial active until expiry
    if (subscription_type === 'team') {
      const { error: updateError } = await supabase
        .from('team_subscriptions')
        .update({
          stripe_subscription_id: null,
        })
        .eq('team_id', entity_id);

      if (updateError) {
        console.error('Failed to update team_subscriptions:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to reset subscription' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      const { error: updateError } = await supabase
        .from('club_subscriptions')
        .update({
          stripe_subscription_id: null,
        })
        .eq('club_id', entity_id);

      if (updateError) {
        console.error('Failed to update club_subscriptions:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to reset subscription' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`${subscription_type} trial/subscription cancelled for ${entity_id} by user ${user.id}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
