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
    // Use TextEncoder for proper UTF-8 handling
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

  // Normalize private key - handle various newline formats
  // The private key might have: literal \n, actual newlines, or \\n
  let privateKey = serviceAccount.private_key;
  
  // First, normalize escaped newlines to actual newlines
  privateKey = privateKey.replace(/\\n/g, '\n');
  
  // Extract the base64 content between the PEM markers
  const pemContents = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/[\r\n\s]/g, ''); // Remove all whitespace including newlines
  
  console.log('[FCM] Private key base64 length:', pemContents.length);
  
  // Decode base64 to binary
  let binaryKey: Uint8Array;
  try {
    const binaryString = atob(pemContents);
    binaryKey = Uint8Array.from(binaryString, c => c.charCodeAt(0));
  } catch (e) {
    console.error('[FCM] Failed to decode private key base64:', e);
    throw new Error('Invalid private key format - base64 decode failed');
  }
  
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
    const { userId, title, body, url, notificationId, tag, data, notificationType } = await req.json();

    console.log(`[FCM] Starting FCM notification for user ${userId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Support both: separate secrets (preferred) or single JSON blob (legacy)
    const fcmProjectId = Deno.env.get('FCM_PROJECT_ID');
    const fcmClientEmail = Deno.env.get('FCM_CLIENT_EMAIL');
    const fcmPrivateKey = Deno.env.get('FCM_PRIVATE_KEY');
    const fcmServiceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT');

    let serviceAccount: { project_id: string; client_email: string; private_key: string };

    // Check for separate secrets first (avoids truncation issues)
    if (fcmProjectId && fcmClientEmail && fcmPrivateKey) {
      console.log('[FCM] Using separate secrets (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY)');
      serviceAccount = {
        project_id: fcmProjectId,
        client_email: fcmClientEmail,
        private_key: fcmPrivateKey,
      };
    } else if (fcmServiceAccountJson) {
      // Fallback to legacy single JSON blob
      console.log('[FCM] Using legacy FCM_SERVICE_ACCOUNT JSON');
      try {
        serviceAccount = JSON.parse(fcmServiceAccountJson);
      } catch (e) {
        console.error('[FCM] Invalid FCM_SERVICE_ACCOUNT JSON:', e);
        return new Response(
          JSON.stringify({ error: 'Invalid service account configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.log('[FCM] FCM not configured - need FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY');
      return new Response(
        JSON.stringify({ message: 'FCM not configured', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const projectId = serviceAccount.project_id;
    if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
      console.error('[FCM] Missing required fields:', { 
        hasProjectId: !!projectId, 
        hasClientEmail: !!serviceAccount.client_email, 
        hasPrivateKey: !!serviceAccount.private_key 
      });
      return new Response(
        JSON.stringify({ error: 'Invalid service account: missing required fields' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[FCM] Project ID:', projectId);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get FCM tokens for this user (only tokens updated in the last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tokens, error: tokenError } = await supabase
      .from('fcm_tokens')
      .select('*')
      .eq('user_id', userId)
      .gte('updated_at', thirtyDaysAgo);

    if (tokenError) {
      console.error('[FCM] Error fetching tokens:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log(`[FCM] No recent FCM tokens found for user ${userId}`);
      
      // Clean up any stale tokens older than 30 days
      const { data: staleTokens } = await supabase
        .from('fcm_tokens')
        .select('id')
        .eq('user_id', userId)
        .lt('updated_at', thirtyDaysAgo);
      
      if (staleTokens && staleTokens.length > 0) {
        await supabase
          .from('fcm_tokens')
          .delete()
          .in('id', staleTokens.map(t => t.id));
        console.log(`[FCM] Cleaned up ${staleTokens.length} stale token(s)`);
      }
      
      return new Response(
        JSON.stringify({ message: 'No recent FCM tokens found', sent: 0 }),
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

    // Build the data payload (FCM v1 requires all values to be strings)
    const dataPayload: Record<string, string> = (() => {
      const raw: Record<string, unknown> = {
        ...(url ? { url } : {}),
        title: title || 'Ignite',
        body: body || 'You have a new notification',
        notificationId: notificationId?.toString() || '',
        tag: tag || `notification-${notificationId || Date.now()}`,
        notificationType: String(notificationType || data?.notificationType || ''),
        type: String(data?.type || notificationType || ''),
        ...(data || {}),
      };
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === null || v === undefined) continue;
        stringified[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return stringified;
    })();

    for (const tokenRecord of tokens) {
      try {
        // Build the FCM message PER-PLATFORM.
        // Android must receive a visible notification payload; data-only FCM
        // can be accepted by Firebase but not shown by the OS when the app is
        // backgrounded/killed. We avoid the previous duplicate-banner issue by
        // using Android-specific notification config instead of also sending a
        // top-level `notification` block to Android.
        const isIos = tokenRecord.platform === 'ios';

        const message: Record<string, unknown> = {
          token: tokenRecord.token,
          data: dataPayload,
        };

        if (isIos) {
          const effectiveTag = tag || `notification-${notificationId || Date.now()}`;
          message.notification = {
            title: title || 'Ignite',
            body: body || 'You have a new notification',
          };
          message.apns = {
            // apns-collapse-id groups updates with the same id in Notification
            // Center so repeated messages in the same chat stack instead of
            // piling up. Max 64 bytes per Apple spec.
            headers: {
              'apns-collapse-id': effectiveTag.slice(0, 64),
              'apns-priority': '10',
            },
            payload: {
              aps: {
                'mutable-content': 1,
                sound: 'default',
                badge: 1,
                // thread-id groups conversations in Notification Center
                'thread-id': effectiveTag,
              },
            },
          };
        } else {
          message.android = {
            priority: 'high',
            notification: {
              title: title || 'Ignite',
              body: body || 'You have a new notification',
              channel_id: 'default',
              sound: 'default',
              tag: tag || `notification-${notificationId || Date.now()}`,
            },
          };
        }

        // Send via FCM HTTP v1 API
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ message }),
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
