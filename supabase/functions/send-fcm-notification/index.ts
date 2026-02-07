import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Send push notification via Firebase Cloud Messaging
 * 
 * This function sends notifications to native Android/iOS apps
 * that use FCM tokens instead of web push subscriptions.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, body, url, notificationId, tag, data } = await req.json();

    console.log(`[FCM] Starting FCM notification for user ${userId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY');

    if (!fcmServerKey) {
      console.log('[FCM] FCM_SERVER_KEY not configured, skipping FCM');
      return new Response(
        JSON.stringify({ message: 'FCM not configured', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get FCM tokens for this user
    const { data: tokens, error: tokenError } = await supabase
      .from('fcm_tokens')
      .select('*')
      .eq('user_id', userId);

    if (tokenError) {
      console.error('[FCM] Error fetching tokens:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log(`[FCM] No FCM tokens found for user ${userId}`);
      return new Response(
        JSON.stringify({ message: 'No FCM tokens found', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[FCM] Found ${tokens.length} FCM token(s)`);

    let successCount = 0;
    const expiredTokens: string[] = [];
    const results: Array<{ token: string; status: string }> = [];

    for (const tokenRecord of tokens) {
      try {
        // Send via FCM HTTP v1 API
        const response = await fetch(
          `https://fcm.googleapis.com/fcm/send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `key=${fcmServerKey}`,
            },
            body: JSON.stringify({
              to: tokenRecord.token,
              notification: {
                title: title || 'Ignite Club HQ',
                body: body || 'You have a new notification',
                icon: '/icon-192.png',
                badge: '/badge-96.png',
                tag: tag || `notification-${notificationId || Date.now()}`,
                click_action: url || '/notifications',
              },
              data: {
                url: url || '/notifications',
                notificationId,
                ...data,
              },
              android: {
                priority: 'high',
                notification: {
                  channel_id: 'default',
                  priority: 'high',
                  default_sound: true,
                  default_vibrate_timings: true,
                },
              },
              apns: {
                payload: {
                  aps: {
                    'mutable-content': 1,
                    sound: 'default',
                    badge: 1,
                  },
                },
              },
            }),
          }
        );

        const result = await response.json();
        console.log('[FCM] Send result:', JSON.stringify(result));

        if (result.success === 1) {
          successCount++;
          results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'sent' });
        } else if (result.failure === 1) {
          // Check for invalid/expired token errors
          const errorResult = result.results?.[0];
          if (
            errorResult?.error === 'NotRegistered' ||
            errorResult?.error === 'InvalidRegistration'
          ) {
            console.log('[FCM] Token expired or invalid, marking for cleanup');
            expiredTokens.push(tokenRecord.id);
            results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'expired' });
          } else {
            console.error('[FCM] Send failed:', errorResult?.error);
            results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'failed' });
          }
        }
      } catch (err) {
        console.error('[FCM] Error sending to token:', err);
        results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'error' });
      }
    }

    // Cleanup expired tokens
    if (expiredTokens.length > 0) {
      await supabase
        .from('fcm_tokens')
        .delete()
        .in('id', expiredTokens);
      console.log(`[FCM] Cleaned up ${expiredTokens.length} expired token(s)`);
    }

    console.log(`[FCM] COMPLETE: ${successCount}/${tokens.length} sent successfully`);

    return new Response(
      JSON.stringify({
        message: 'FCM notifications processed',
        sent: successCount,
        total: tokens.length,
        cleaned: expiredTokens.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[FCM] FATAL ERROR:', err);
    return new Response(
      JSON.stringify({ error: 'An error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
