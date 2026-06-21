import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 requests per window

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

  // Try to get or create rate limit record
  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .single();

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);
    
    // If window has expired, reset the counter
    if (recordWindowStart < windowStart) {
      await supabase
        .from('rate_limits')
        .update({
          request_count: 1,
          window_start: now.toISOString(),
          updated_at: now.toISOString()
        })
        .eq('id', existing.id);
      
      return {
        allowed: true,
        remaining: RATE_LIMIT_MAX_REQUESTS - 1,
        resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000)
      };
    }

    // Check if rate limit exceeded
    if (existing.request_count >= RATE_LIMIT_MAX_REQUESTS) {
      const resetAt = new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt
      };
    }

    // Increment counter
    await supabase
      .from('rate_limits')
      .update({
        request_count: existing.request_count + 1,
        updated_at: now.toISOString()
      })
      .eq('id', existing.id);

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - existing.request_count - 1,
      resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000)
    };
  }

  // Create new rate limit record
  await supabase
    .from('rate_limits')
    .insert({
      identifier,
      endpoint,
      request_count: 1,
      window_start: now.toISOString()
    });

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - 1,
    resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000)
  };
}

// Price IDs would be configured in Stripe dashboard
// These are placeholder product configurations
const TEAM_PRICING = {
  pro: {
    monthly: 2499, // $24.99 AUD in cents
    annual: 23900, // $239 AUD in cents
  },
  pro_football: {
    monthly: 3999, // $39.99 AUD in cents
    annual: 37999, // $379.99 AUD in cents
  },
};

const CLUB_PRICING = {
  pro: {
    starter: { monthly: 8999, annual: 94999, teamLimit: 10 },
    standard: { monthly: 14999, annual: 144999, teamLimit: 20 },
    unlimited: { monthly: 19999, annual: null, teamLimit: null },
  },
  pro_football: {
    starter: { monthly: 14900, annual: null, teamLimit: 10 },
    standard: { monthly: 22999, annual: null, teamLimit: 20 },
    unlimited: { monthly: 29900, annual: null, teamLimit: null },
  },
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      subscriptionType, // 'team' or 'club'
      entityId, // teamId or clubId
      tier, // 'pro' or 'pro_football'
      plan, // 'starter', 'standard', 'unlimited' (for club only)
      isAnnual,
      withTrial, // boolean - whether to add 14-day trial
      successUrl,
      cancelUrl,
    } = await req.json();

    console.log('Creating subscription checkout:', { subscriptionType, entityId, tier, plan, isAnnual, withTrial });

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || '' } }
    });

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role client for rate limiting and authorization checks
    const supabaseService = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Rate limiting check
    const rateLimitResult = await checkRateLimit(supabaseService, user.id, 'create-subscription-checkout');
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id} on create-subscription-checkout`);
      return new Response(
        JSON.stringify({ 
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000))
          } 
        }
      );
    }

    // Get the entity details and Stripe config
    let entityName: string;
    let clubId: string;
    let stripeSecretKey: string | null = null;

    if (subscriptionType === 'team') {
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('id, name, club_id, clubs!club_id(name)')
        .eq('id', entityId)
        .single();

      if (teamError || !team) {
        console.error('Team not found:', teamError);
        return new Response(
          JSON.stringify({ error: 'Team not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // SECURITY: Verify user has admin/coach role for this team
      const { data: userRole, error: roleError } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('team_id', entityId)
        .in('role', ['team_admin', 'coach', 'club_admin'])
        .maybeSingle();

      // Also check if user is club admin for the parent club
      const { data: clubAdminRole } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('club_id', team.club_id)
        .eq('role', 'club_admin')
        .maybeSingle();

      // Also check for app_admin
      const { data: appAdminRole } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'app_admin')
        .maybeSingle();

      if (!userRole && !clubAdminRole && !appAdminRole) {
        console.error('User not authorized for team subscription:', { userId: user.id, teamId: entityId });
        return new Response(
          JSON.stringify({ error: 'You are not authorized to manage subscriptions for this team' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      entityName = team.name;
      clubId = team.club_id;
    } else {
      const { data: club, error: clubError } = await supabase
        .from('clubs')
        .select('id, name')
        .eq('id', entityId)
        .single();

      if (clubError || !club) {
        console.error('Club not found:', clubError);
        return new Response(
          JSON.stringify({ error: 'Club not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // SECURITY: Verify user is club admin for this club
      const { data: clubAdminRole, error: roleError } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('club_id', entityId)
        .eq('role', 'club_admin')
        .maybeSingle();

      // Also check for app_admin
      const { data: appAdminRole } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'app_admin')
        .maybeSingle();

      if (!clubAdminRole && !appAdminRole) {
        console.error('User not authorized for club subscription:', { userId: user.id, clubId: entityId });
        return new Response(
          JSON.stringify({ error: 'You are not authorized to manage subscriptions for this club' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      entityName = club.name;
      clubId = club.id;
    }

    // Get club's Stripe config using service role to read the secret key
    const { data: stripeConfig } = await supabaseService
      .from('club_stripe_configs')
      .select('stripe_secret_key, is_enabled')
      .eq('club_id', clubId)
      .eq('is_enabled', true)
      .maybeSingle();

    // If no club Stripe config, check app-level config
    if (!stripeConfig?.stripe_secret_key) {
      const { data: appStripeConfig } = await supabaseService
        .from('app_stripe_config')
        .select('stripe_secret_key, is_enabled')
        .eq('is_enabled', true)
        .maybeSingle();

      if (!appStripeConfig?.stripe_secret_key) {
        console.error('No Stripe configuration found');
        return new Response(
          JSON.stringify({ error: 'Stripe not configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      stripeSecretKey = appStripeConfig.stripe_secret_key;
    } else {
      stripeSecretKey = stripeConfig.stripe_secret_key;
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Calculate pricing
    let unitAmount: number;
    let productName: string;
    let interval: 'month' | 'year' = isAnnual ? 'year' : 'month';
    let teamLimit: number | null = null;

    if (subscriptionType === 'team') {
      const tierPricing = tier === 'pro' ? TEAM_PRICING.pro : TEAM_PRICING.pro_football;
      unitAmount = isAnnual ? tierPricing.annual : tierPricing.monthly;
      productName = tier === 'pro' ? 'Team Pro Subscription' : 'Team Pro Football Subscription';
    } else {
      const tierPricing = tier === 'pro' ? CLUB_PRICING.pro : CLUB_PRICING.pro_football;
      const planPricing = tierPricing[plan as keyof typeof tierPricing];
      if (isAnnual && !planPricing.annual) {
        return new Response(
          JSON.stringify({ error: 'Annual billing is not available for this plan' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      unitAmount = isAnnual ? planPricing.annual! : planPricing.monthly;
      teamLimit = planPricing.teamLimit;
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      productName = tier === 'pro' 
        ? `Club Pro ${planName} Subscription` 
        : `Club Pro Football ${planName} Subscription`;
    }

    // Check if customer already exists
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

    // Calculate platform fee (5%)
    const platformFeeCents = Math.round(unitAmount * 0.05);

    // Create the checkout session for subscription
    const sessionConfig: any = {
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'aud',
            unit_amount: unitAmount,
            product_data: {
              name: productName,
              description: `${entityName} - ${isAnnual ? 'Annual' : 'Monthly'} billing`,
            },
            recurring: {
              interval: interval,
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'aud',
            unit_amount: platformFeeCents,
            product_data: {
              name: 'Ignite Platform Fee',
              description: 'Ignite Club HQ processing fee (5%)',
            },
            recurring: {
              interval: interval,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        subscription_type: subscriptionType,
        entity_id: entityId,
        club_id: clubId,
        tier: tier,
        plan: plan || 'none',
        team_limit: teamLimit?.toString() || 'null',
        user_id: user.id,
        is_annual: isAnnual.toString(),
        with_trial: (withTrial || false).toString(),
        platform_fee_cents: platformFeeCents.toString(),
      },
      success_url: successUrl || `${req.headers.get('origin')}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/subscription-cancelled`,
    };

    // Add 14-day trial period if requested
    if (withTrial) {
      sessionConfig.subscription_data = {
        trial_period_days: 14,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('Checkout session created:', session.id);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error creating subscription checkout:', error);
    // Sanitize error message - don't expose internal details
    return new Response(
      JSON.stringify({ error: 'Payment processing failed. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
});
