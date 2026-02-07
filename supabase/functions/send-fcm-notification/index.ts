import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Send push notification via Firebase Cloud Messaging (v1 API)
 * 
 * This function sends notifications to native Android/iOS apps
 * using the modern FCM HTTP v1 API with service account authentication.
 */

// Cache for access token (valid for ~1 hour)
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(serviceAccount: any): Promise<string> {
  // Check cache
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60000) {
    return cachedAccessToken.token;
  }

  // Create JWT for Google OAuth2
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  // Base64URL encode
  const base64UrlEncode = (obj: any) => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

  // Import private key and sign
  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const jwt = `${unsignedToken}.${signatureBase64}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  // Cache the token
  cachedAccessToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000),
  };

  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, body, url, notificationId, tag, data } = await req.json();

    console.log(`[FCM] Starting FCM notification for user ${userId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fcmServiceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT');

    if (!fcmServiceAccountJson) {
      console.log('[FCM] FCM_SERVICE_ACCOUNT not configured, skipping FCM');
      return new Response(
        JSON.stringify({ message: 'FCM not configured', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(fcmServiceAccountJson);
    } catch (e) {
      console.error('[FCM] Invalid FCM_SERVICE_ACCOUNT JSON:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid service account configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const projectId = serviceAccount.project_id;
    if (!projectId) {
      console.error('[FCM] No project_id in service account');
      return new Response(
        JSON.stringify({ error: 'Invalid service account: missing project_id' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Get access token
    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccount);
    } catch (err) {
      console.error('[FCM] Failed to get access token:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with FCM' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let successCount = 0;
    const expiredTokens: string[] = [];
    const results: Array<{ token: string; status: string }> = [];

    for (const tokenRecord of tokens) {
      try {
        // Send via FCM HTTP v1 API
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              message: {
                token: tokenRecord.token,
                notification: {
                  title: title || 'Ignite Club HQ',
                  body: body || 'You have a new notification',
                },
                data: {
                  url: url || '/notifications',
                  notificationId: notificationId?.toString() || '',
                  tag: tag || `notification-${notificationId || Date.now()}`,
                  ...(data || {}),
                },
                android: {
                  priority: 'high',
                  notification: {
                    channel_id: 'default',
                    icon: 'ic_notification',
                    sound: 'default',
                    click_action: 'FLUTTER_NOTIFICATION_CLICK',
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
              },
            }),
          }
        );

        const result = await response.json();
        console.log('[FCM] Send result:', JSON.stringify(result));

        if (response.ok) {
          successCount++;
          results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'sent' });
        } else {
          // Check for invalid/expired token errors
          const errorCode = result.error?.details?.[0]?.errorCode || result.error?.code;
          if (
            errorCode === 'UNREGISTERED' ||
            errorCode === 'INVALID_ARGUMENT' ||
            result.error?.message?.includes('not a valid FCM registration token')
          ) {
            console.log('[FCM] Token expired or invalid, marking for cleanup');
            expiredTokens.push(tokenRecord.id);
            results.push({ token: tokenRecord.token.substring(0, 20) + '...', status: 'expired' });
          } else {
            console.error('[FCM] Send failed:', result.error);
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
