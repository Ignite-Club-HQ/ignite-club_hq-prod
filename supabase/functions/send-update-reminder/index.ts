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
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const callerUserId = user.id;

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

    const body = await req.json();
    const { action } = body;

    // LIST USERS MODE - returns FCM token users with version info
    if (action === 'list-users') {
      const { clubId } = body;

      // Get all FCM tokens using service role (bypasses RLS)
      const { data: fcmTokens, error: fcmError } = await adminClient
        .from('fcm_tokens')
        .select('user_id, platform, app_version, build_number');

      if (fcmError) {
        console.error('FCM tokens fetch error:', fcmError);
        return new Response(JSON.stringify({ error: 'Failed to fetch FCM tokens' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!fcmTokens || fcmTokens.length === 0) {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let userIds = [...new Set(fcmTokens.map((t: any) => t.user_id))];

      // Filter by club if specified
      if (clubId && clubId !== 'all') {
        const { data: clubRoles } = await adminClient
          .from('user_roles')
          .select('user_id')
          .eq('club_id', clubId);

        const { data: clubTeams } = await adminClient
          .from('teams')
          .select('id')
          .eq('club_id', clubId);

        const teamIds = clubTeams?.map(t => t.id) || [];
        let teamUserIds: string[] = [];
        if (teamIds.length > 0) {
          const { data: teamRoles } = await adminClient
            .from('user_roles')
            .select('user_id')
            .in('team_id', teamIds);
          teamUserIds = teamRoles?.map(r => r.user_id) || [];
        }

        const clubUserIds = new Set([
          ...(clubRoles?.map(r => r.user_id) || []),
          ...teamUserIds,
        ]);
        userIds = userIds.filter(id => clubUserIds.has(id));
      }

      if (userIds.length === 0) {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch profiles
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      // Build user list with latest token info per user
      const userMap = new Map();
      for (const token of fcmTokens) {
        if (!userIds.includes(token.user_id)) continue;
        const profile = profileMap.get(token.user_id);
        if (!profile) continue;

        const existing = userMap.get(token.user_id);
        if (!existing || (token.app_version && !existing.appVersion)) {
          userMap.set(token.user_id, {
            userId: token.user_id,
            name: profile.display_name || 'Unknown',
            platform: token.platform || 'unknown',
            appVersion: token.app_version || null,
            buildNumber: token.build_number || null,
          });
        }
      }

      const users = Array.from(userMap.values()).sort((a: any, b: any) => a.name.localeCompare(b.name));

      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // SEND MODE (default) - send update reminder notifications
    const { userIds } = body;

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

          const { error } = await adminClient.functions.invoke('send-push-notification', {
            body: {
              userId,
              title: '📲 App Update Available',
              body: 'A new version of Ignite Club HQ is available. Please update for the best experience!',
              // Don't send store URL as the notification url — it gets routed through
              // the SPA router on tap and causes a 404. Instead, send a safe internal path.
              // The notification message itself tells the user to update.
              url: '/notifications',
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
