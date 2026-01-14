import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clubId, paymentPeriod, successUrl, cancelUrl } = await req.json();

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')?.split(' ')[1];
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is a club member
    const { data: isMember, error: memberError } = await supabase.rpc('is_club_member', {
      _user_id: user.id,
      _club_id: clubId
    });

    if (memberError || !isMember) {
      return new Response(
        JSON.stringify({ error: 'Not a club member' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if member payments are enabled and get amount
    const { data: subscription, error: subError } = await supabase
      .from('club_subscriptions')
      .select('member_payments_enabled, member_subscription_amount')
      .eq('club_id', clubId)
      .maybeSingle();

    if (subError) {
      console.error('Error fetching club subscription:', subError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch club settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!subscription?.member_payments_enabled) {
      return new Response(
        JSON.stringify({ error: 'Online payments are not enabled for this club' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!subscription.member_subscription_amount || subscription.member_subscription_amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Subscription amount not set' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already paid
    const { data: existingPayment } = await supabase
      .from('member_subscription_payments')
      .select('id')
      .eq('user_id', user.id)
      .eq('club_id', clubId)
      .eq('payment_period', paymentPeriod)
      .maybeSingle();

    if (existingPayment) {
      return new Response(
        JSON.stringify({ error: 'Already paid for this period' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get club details
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('name')
      .eq('id', clubId)
      .single();

    if (clubError || !club) {
      return new Response(
        JSON.stringify({ error: 'Club not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Stripe secret key - first try club config, then app config
    let stripeSecretKey: string | null = null;
    
    const { data: clubStripeConfig } = await supabase
      .from('club_stripe_configs')
      .select('stripe_secret_key, is_enabled')
      .eq('club_id', clubId)
      .maybeSingle();

    if (clubStripeConfig?.is_enabled && clubStripeConfig?.stripe_secret_key) {
      stripeSecretKey = clubStripeConfig.stripe_secret_key;
    } else {
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
      return new Response(
        JSON.stringify({ error: 'Stripe is not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Stripe
    const Stripe = (await import('https://esm.sh/stripe@14.21.0')).default;
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    // Check if customer exists
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    let customerId = customers.data[0]?.id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aud',
            product_data: {
              name: `${club.name} - Club Subscription`,
              description: `Subscription payment for ${paymentPeriod}`,
            },
            unit_amount: Math.round(subscription.member_subscription_amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'member_subscription',
        club_id: clubId,
        user_id: user.id,
        payment_period: paymentPeriod,
        amount: subscription.member_subscription_amount.toString(),
      },
    });

    console.log('Created member payment checkout session:', session.id);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-member-payment-checkout:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
