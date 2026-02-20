import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Storage pack pricing
const STORAGE_PACKS = {
  '10gb': { gb: 10, priceMonthly: 499, priceAnnual: 4999, name: '10GB Storage Pack' },
  '50gb': { gb: 50, priceMonthly: 1499, priceAnnual: 14999, name: '50GB Storage Pack' },
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clubId, packType, isAnnual, successUrl, cancelUrl } = await req.json();

    console.log('Creating storage checkout:', { clubId, packType, isAnnual });

    // Validate pack type
    const pack = STORAGE_PACKS[packType as keyof typeof STORAGE_PACKS];
    if (!pack) {
      return new Response(
        JSON.stringify({ error: 'Invalid storage pack type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'User not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is a club admin
    const { data: isClubAdmin, error: roleError } = await supabase
      .rpc('has_role', { 
        _user_id: user.id, 
        _role: 'club_admin',
        _club_id: clubId,
        _team_id: null
      });

    if (roleError) {
      console.error('Error checking admin role:', roleError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isClubAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only club administrators can purchase storage' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get club details
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, name')
      .eq('id', clubId)
      .single();

    if (clubError || !club) {
      return new Response(
        JSON.stringify({ error: 'Club not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try to get Stripe secret key from club config first
    let stripeSecretKey: string | null = null;
    
    const { data: clubStripeConfig } = await supabase
      .from('club_stripe_configs')
      .select('stripe_secret_key, is_enabled')
      .eq('club_id', clubId)
      .maybeSingle();

    if (clubStripeConfig?.stripe_secret_key && clubStripeConfig.is_enabled) {
      stripeSecretKey = clubStripeConfig.stripe_secret_key;
    }

    // Fall back to app-level Stripe config
    if (!stripeSecretKey) {
      const { data: appStripeConfig } = await supabase
        .from('app_stripe_config')
        .select('stripe_secret_key, is_enabled')
        .maybeSingle();

      if (appStripeConfig?.stripe_secret_key && appStripeConfig.is_enabled) {
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
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    const unitAmount = isAnnual ? pack.priceAnnual : pack.priceMonthly;
    const interval = isAnnual ? 'year' : 'month';

    // Create or retrieve customer
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id,
        },
      });
      customerId = customer.id;
    }

    // Create a checkout session for the storage subscription
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'aud',
            unit_amount: unitAmount,
            recurring: {
              interval: interval,
            },
            product_data: {
              name: pack.name,
              description: `Additional ${pack.gb}GB storage for ${club.name}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'storage_addon',
        club_id: clubId,
        user_id: user.id,
        storage_gb: pack.gb.toString(),
        is_annual: isAnnual.toString(),
      },
      success_url: successUrl || `${req.headers.get('origin')}/vault?success=storage`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/vault?cancelled=true`,
    });

    console.log('Storage checkout session created:', session.id);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error creating storage checkout:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
