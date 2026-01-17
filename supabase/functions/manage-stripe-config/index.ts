import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StripeConfigRequest {
  action: 'get' | 'save' | 'delete' | 'validate';
  configType: 'app' | 'club';
  clubId?: string;
  secretKey?: string;
  publishableKey?: string;
  isEnabled?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, configType, clubId, secretKey, publishableKey, isEnabled } = await req.json() as StripeConfigRequest;

    console.log('Stripe config request:', { action, configType, clubId: clubId || 'N/A' });

    // Get user auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service role client for database operations
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check authorization
    let isAuthorized = false;

    if (configType === 'app') {
      // Only app_admin can manage app-level Stripe config
      const { data: appAdminRole } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'app_admin')
        .maybeSingle();
      
      isAuthorized = !!appAdminRole;
    } else if (configType === 'club' && clubId) {
      // Club admin or app admin can manage club Stripe config
      const { data: roles } = await supabaseAdmin
        .from('user_roles')
        .select('role, club_id')
        .eq('user_id', user.id)
        .or(`role.eq.app_admin,and(role.eq.club_admin,club_id.eq.${clubId})`);
      
      isAuthorized = roles && roles.length > 0;
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle different actions
    switch (action) {
      case 'get': {
        // Return only non-sensitive info (is configured, is enabled)
        // NEVER return the actual secret key to the frontend
        if (configType === 'app') {
          const { data: config } = await supabaseAdmin
            .from('app_stripe_config')
            .select('id, is_enabled, stripe_publishable_key, created_at, updated_at')
            .maybeSingle();
          
          return new Response(
            JSON.stringify({
              configured: !!config,
              isEnabled: config?.is_enabled ?? false,
              publishableKey: config?.stripe_publishable_key || null,
              hasSecretKey: !!config?.stripe_publishable_key, // Indicates a key is set
              createdAt: config?.created_at,
              updatedAt: config?.updated_at,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          const { data: config } = await supabaseAdmin
            .from('club_stripe_configs')
            .select('id, is_enabled, stripe_publishable_key, created_at, updated_at')
            .eq('club_id', clubId)
            .maybeSingle();
          
          return new Response(
            JSON.stringify({
              configured: !!config,
              isEnabled: config?.is_enabled ?? false,
              publishableKey: config?.stripe_publishable_key || null,
              hasSecretKey: !!config?.stripe_publishable_key,
              createdAt: config?.created_at,
              updatedAt: config?.updated_at,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'validate': {
        // Validate Stripe keys by making a test API call
        if (!secretKey) {
          return new Response(
            JSON.stringify({ error: 'Secret key required for validation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate key format
        if (!secretKey.startsWith('sk_')) {
          return new Response(
            JSON.stringify({ valid: false, error: 'Invalid secret key format' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (publishableKey && !publishableKey.startsWith('pk_')) {
          return new Response(
            JSON.stringify({ valid: false, error: 'Invalid publishable key format' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          // Test the key by making a simple Stripe API call
          const response = await fetch('https://api.stripe.com/v1/balance', {
            headers: {
              'Authorization': `Bearer ${secretKey}`,
            },
          });

          if (response.ok) {
            return new Response(
              JSON.stringify({ valid: true }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            const error = await response.json();
            return new Response(
              JSON.stringify({ valid: false, error: error.error?.message || 'Invalid API key' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (e) {
          return new Response(
            JSON.stringify({ valid: false, error: 'Failed to validate key' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'save': {
        // Validate inputs
        if (!secretKey || !publishableKey) {
          return new Response(
            JSON.stringify({ error: 'Both secret key and publishable key are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!secretKey.startsWith('sk_')) {
          return new Response(
            JSON.stringify({ error: 'Invalid secret key format. Must start with sk_' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!publishableKey.startsWith('pk_')) {
          return new Response(
            JSON.stringify({ error: 'Invalid publishable key format. Must start with pk_' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate the key actually works before saving
        const validateResponse = await fetch('https://api.stripe.com/v1/balance', {
          headers: {
            'Authorization': `Bearer ${secretKey}`,
          },
        });

        if (!validateResponse.ok) {
          const error = await validateResponse.json();
          return new Response(
            JSON.stringify({ error: `Invalid Stripe API key: ${error.error?.message || 'Authentication failed'}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const configData = {
          stripe_secret_key: secretKey.trim(),
          stripe_publishable_key: publishableKey.trim(),
          is_enabled: isEnabled ?? true,
          updated_at: new Date().toISOString(),
        };

        if (configType === 'app') {
          // Check if config exists
          const { data: existing } = await supabaseAdmin
            .from('app_stripe_config')
            .select('id')
            .maybeSingle();

          if (existing) {
            const { error } = await supabaseAdmin
              .from('app_stripe_config')
              .update(configData)
              .eq('id', existing.id);
            
            if (error) throw error;
          } else {
            const { error } = await supabaseAdmin
              .from('app_stripe_config')
              .insert(configData);
            
            if (error) throw error;
          }
        } else {
          // Check if club config exists
          const { data: existing } = await supabaseAdmin
            .from('club_stripe_configs')
            .select('id')
            .eq('club_id', clubId)
            .maybeSingle();

          if (existing) {
            const { error } = await supabaseAdmin
              .from('club_stripe_configs')
              .update(configData)
              .eq('id', existing.id);
            
            if (error) throw error;
          } else {
            const { error } = await supabaseAdmin
              .from('club_stripe_configs')
              .insert({ ...configData, club_id: clubId });
            
            if (error) throw error;
          }
        }

        console.log(`Stripe config saved for ${configType}${clubId ? `: ${clubId}` : ''}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (configType === 'app') {
          const { error } = await supabaseAdmin
            .from('app_stripe_config')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
          
          if (error) throw error;
        } else {
          const { error } = await supabaseAdmin
            .from('club_stripe_configs')
            .delete()
            .eq('club_id', clubId);
          
          if (error) throw error;
        }

        console.log(`Stripe config deleted for ${configType}${clubId ? `: ${clubId}` : ''}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in manage-stripe-config:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
