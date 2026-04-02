import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Verify caller is app_admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(
      authHeader.replace('Bearer ', '')
    );
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const callerUserId = claimsData.claims.sub;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check app_admin role
    const { data: adminRole } = await adminClient
      .from('user_roles')
      .select('id')
      .eq('user_id', callerUserId)
      .eq('role', 'app_admin')
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: 'Forbidden - app_admin required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { userIds } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({ error: 'userIds array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // For each user, determine their platform from fcm_tokens and send appropriate notification
    const results: { userId: string; status: string; platform?: string }[] = [];

    // Get platform info for all target users
    const { data: tokens } = await adminClient
      .from('fcm_tokens')
      .select('user_id, platform')
      .in('user_id', userIds);

    const platformMap = new Map<string, string>();
    for (const t of tokens || []) {
      platformMap.set(t.user_id, t.platform);
    }

    const APP_STORE_URL = 'https://apps.apple.com/au/app/ignite-club-hq/id6758928691';
    const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub';

    // Send notifications in batches of 10
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const promises = batch.map(async (userId: string) => {
        try {
          const platform = platformMap.get(userId) || 'unknown';
          const storeUrl = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;

          const { error } = await adminClient.functions.invoke('send-push-notification', {
            body: {
              userId,
              title: '📲 App Update Available',
              body: 'A new version of Ignite Club HQ is available. Please update for the best experience!',
              url: storeUrl,
              tag: `app-update-reminder-${Date.now()}`,
              notificationType: 'system_update',
            },
          });

          if (error) {
            console.error(`Failed to send to ${userId}:`, error);
            results.push({ userId, status: 'failed', platform });
          } else {
            results.push({ userId, status: 'sent', platform });
          }
        } catch (err) {
          console.error(`Error sending to ${userId}:`, err);
          results.push({ userId, status: 'error' });
        }
      });
      await Promise.all(promises);
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status !== 'sent').length;

    return new Response(
      JSON.stringify({ message: `Sent ${sent}, failed ${failed}`, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('send-update-reminder error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
