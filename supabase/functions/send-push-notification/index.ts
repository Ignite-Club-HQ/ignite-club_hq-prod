import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Module-scope env + client: created once per isolate, reused across warm invocations.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@igniteclubhq.com';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000]; // 1s, 2s

// Base64url utilities with robust handling
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let cleaned = base64Url.trim();
  cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (cleaned.length % 4)) % 4;
  cleaned += '='.repeat(padding);
  
  try {
    const rawData = atob(cleaned);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  } catch (e) {
    console.error('Base64 decode error');
    throw e;
  }
}

function uint8ArrayToBase64Url(array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// HKDF implementation
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    ikm.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { 
      name: 'HKDF', 
      hash: 'SHA-256', 
      salt: salt.buffer as ArrayBuffer, 
      info: info.buffer as ArrayBuffer 
    },
    keyMaterial,
    length * 8
  );
  return new Uint8Array(derivedBits);
}

// Generate signed VAPID JWT
async function generateVapidJwt(audience: string, subject: string, privateKeyBase64: string, publicKeyBase64: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: subject
  };

  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  try {
    const privateKeyBytes = base64UrlToUint8Array(privateKeyBase64);
    const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64);
    
    if (publicKeyBytes.length !== 65) {
      throw new Error('Invalid key length');
    }
    
    if (privateKeyBytes.length !== 32) {
      throw new Error('Invalid key length');
    }
    
    const x = publicKeyBytes.slice(1, 33);
    const y = publicKeyBytes.slice(33, 65);
    
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: uint8ArrayToBase64Url(x),
      y: uint8ArrayToBase64Url(y),
      d: uint8ArrayToBase64Url(privateKeyBytes),
    };

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    );

    const signatureBytes = new Uint8Array(signatureBuffer);
    const signatureB64 = uint8ArrayToBase64Url(signatureBytes);

    return `${unsignedToken}.${signatureB64}`;
  } catch (error) {
    console.error('Error signing VAPID JWT');
    throw error;
  }
}

// Encrypt payload using Web Push encryption (RFC 8291)
async function encryptPayload(
  payload: string,
  p256dhBase64: string,
  authBase64: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const p256dh = base64UrlToUint8Array(p256dhBase64);
  const auth = base64UrlToUint8Array(authBase64);

  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKey = new Uint8Array(localPublicKeyRaw);

  const subscriberKey = await crypto.subtle.importKey(
    'raw',
    p256dh.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const ikm = await hkdf(auth, sharedSecret, authInfo, 32);

  const keyInfo = concatUint8Arrays(
    new TextEncoder().encode('Content-Encoding: aes128gcm\0P-256\0'),
    new Uint8Array([0, 65]),
    p256dh,
    new Uint8Array([0, 65]),
    localPublicKey
  );
  const key = await hkdf(salt, ikm, keyInfo, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const plaintext = new TextEncoder().encode(payload);
  const paddedPlaintext = new Uint8Array(plaintext.length + 2);
  paddedPlaintext.set(plaintext, 0);
  paddedPlaintext[plaintext.length] = 2;

  const aesKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    aesKey,
    paddedPlaintext
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    salt,
    localPublicKey
  };
}

function buildAes128gcmBody(salt: Uint8Array, localPublicKey: Uint8Array, ciphertext: Uint8Array): ArrayBuffer {
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  
  const result = concatUint8Arrays(
    salt,
    recordSize,
    new Uint8Array([localPublicKey.length]),
    localPublicKey,
    ciphertext
  );
  
  return result.buffer as ArrayBuffer;
}

// Log push notification delivery status
// Uses insert for new entries. If a placeholder was pre-inserted during dedup claiming,
// the endpoint will be 'pending' — we update it instead.
async function logDeliveryStatus(
  supabase: any,
  notificationId: string | null,
  userId: string,
  endpoint: string,
  status: 'sent' | 'failed' | 'expired' | 'invalid' | 'skipped',
  statusCode: number | null,
  errorMessage: string | null,
  retryCount: number = 0
) {
  try {
    const logData = {
      notification_id: notificationId,
      user_id: userId,
      endpoint: endpoint.substring(0, 500),
      status,
      status_code: statusCode,
      error_message: errorMessage ? `${errorMessage} (retries: ${retryCount})`.substring(0, 1000) : null
    };

    // If we pre-claimed with a placeholder, update instead of inserting a duplicate
    if (notificationId) {
      const { data: existing } = await supabase
        .from('push_notification_logs')
        .select('id, endpoint')
        .eq('notification_id', notificationId)
        .eq('endpoint', 'pending')
        .maybeSingle();

      if (existing) {
        await supabase
          .from('push_notification_logs')
          .update({ endpoint: logData.endpoint, status: logData.status, status_code: logData.status_code, error_message: logData.error_message })
          .eq('id', existing.id);
        return;
      }
    }

    const { error } = await supabase
      .from('push_notification_logs')
      .insert(logData);
    
    if (error) {
      console.error('Failed to log push delivery status');
    }
  } catch (err) {
    console.error('Error logging push delivery');
  }
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send push notification with retry logic
async function sendPushWithRetry(
  sub: any,
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<{ success: boolean; statusCode: number | null; error?: string; retryCount: number }> {
  let lastError: string | null = null;
  let lastStatusCode: number | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Wait before retry (not on first attempt)
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] || 2000;
        console.log(`[PUSH] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms`);
        await sleep(delay);
      }

      const { ciphertext, salt, localPublicKey } = await encryptPayload(
        payload,
        sub.p256dh,
        sub.auth
      );

      const encryptedBody = buildAes128gcmBody(salt, localPublicKey, ciphertext);

      const endpointUrl = new URL(sub.endpoint);
      const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

      const vapidJwt = await generateVapidJwt(
        audience,
        vapidSubject,
        vapidPrivateKey,
        vapidPublicKey
      );

      const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'Content-Length': String(encryptedBody.byteLength),
          'TTL': '86400',
          'Urgency': 'high',
          'Authorization': `vapid t=${vapidJwt}, k=${vapidPublicKey}`
        },
        body: encryptedBody
      });
      
      lastStatusCode = response.status;
      
      if (response.status === 201 || response.status === 200) {
        return { success: true, statusCode: response.status, retryCount: attempt };
      }
      
      // Don't retry for permanent failures
      if (response.status === 410 || response.status === 404) {
        return { 
          success: false, 
          statusCode: response.status, 
          error: 'Subscription expired',
          retryCount: attempt 
        };
      }
      
      if (response.status === 401 || response.status === 403) {
        return { 
          success: false, 
          statusCode: response.status, 
          error: 'Authorization failed',
          retryCount: attempt 
        };
      }

      // Retry on 5xx errors or 429 (rate limit)
      if (response.status >= 500 || response.status === 429) {
        lastError = `Server error: ${response.status}`;
        console.log(`[PUSH] Retryable error: ${response.status}`);
        continue;
      }

      // Other errors - don't retry
      lastError = `Failed with status: ${response.status}`;
      return { 
        success: false, 
        statusCode: response.status, 
        error: lastError,
        retryCount: attempt 
      };
      
    } catch (err: any) {
      lastError = err.message || 'Unknown error';
      console.error(`[PUSH] Attempt ${attempt + 1} error:`, lastError);
      
      // Network errors might be temporary - retry
      if (attempt < MAX_RETRIES) {
        continue;
      }
    }
  }

  return { 
    success: false, 
    statusCode: lastStatusCode, 
    error: lastError || 'Max retries exceeded',
    retryCount: MAX_RETRIES 
  };
}

// Send FCM notification to native app users via the send-fcm-notification edge function
async function sendFCMNotifications(
  supabase: any,
  userId: string,
  title: string,
  body: string,
  url: string,
  notificationId: string | null,
  tag: string,
  notificationType?: string,
  extraData?: Record<string, unknown>
): Promise<{ sent: number; total: number }> {
  const hasSeparateSecrets = Boolean(
    Deno.env.get('FCM_PROJECT_ID') &&
    Deno.env.get('FCM_CLIENT_EMAIL') &&
    Deno.env.get('FCM_PRIVATE_KEY')
  );
  const hasLegacyServiceAccount = Boolean(Deno.env.get('FCM_SERVICE_ACCOUNT'));
  
  if (!hasSeparateSecrets && !hasLegacyServiceAccount) {
    console.log('[PUSH] FCM secrets not configured, skipping native push');
    return { sent: 0, total: 0 };
  }

  try {
    // Call the dedicated FCM edge function
    console.log(`[PUSH] Invoking send-fcm-notification for user ${userId}`);
    
    const { data: responseData, error } = await supabase.functions.invoke('send-fcm-notification', {
      body: {
        userId,
        title: title || 'Ignite',
        body: body || 'You have a new notification',
        url,
        notificationId,
        tag: tag || `notification-${notificationId || Date.now()}`,
        notificationType,
        data: {
          ...(notificationType ? {
            notificationType,
            type: notificationType,
          } : {}),
          ...(extraData || {}),
        },
      },
    });

    if (error) {
      console.error('[PUSH] FCM function error:', error);
      return { sent: 0, total: 0 };
    }

    console.log('[PUSH] FCM function response:', JSON.stringify(responseData));
    return { sent: responseData?.sent || 0, total: responseData?.total || 0 };
  } catch (err) {
    console.error('[PUSH] Error calling FCM function:', err);
    return { sent: 0, total: 0 };
  }
}

// Map notification type to preference column
function getPreferenceColumn(notificationType: string | undefined): string | null {
  if (!notificationType) return null;
  
  const typeMap: Record<string, string> = {
    // Message types (matches DB inserts: team_message, club_message, group_message, etc.)
    'team_message': 'messages_enabled',
    'club_message': 'messages_enabled',
    'group_message': 'messages_enabled',
    'direct_message': 'messages_enabled',
    'broadcast': 'messages_enabled',
    'message_reply': 'messages_enabled',
    'message_mention': 'messages_enabled',
    'message_reaction': 'messages_enabled',
    'club_admin_message': 'messages_enabled',
    // Event types (matches DB inserts: event_invite, event_cancelled, etc.)
    'event_invite': 'events_enabled',
    'event_reminder': 'events_enabled',
    'event_view_reminder': 'events_enabled',
    'event_cancelled': 'events_enabled',
    'event_updated': 'events_enabled',
    'duty_assigned': 'events_enabled',
    'rsvp_updated': 'events_enabled',
    'rsvp_reminder': 'events_enabled',
    // Media types (matches DB inserts: photo_uploaded, photo_comment, etc.)
    'photo_uploaded': 'media_enabled',
    'photo_comment': 'media_enabled',
    'photo_reaction': 'media_enabled',
    'comment_reaction': 'media_enabled',
    'comment_reply': 'media_enabled',
    // Membership types (matches DB inserts: membership, join_request, team_invite, etc.)
    'membership': 'membership_enabled',
    'team_join': 'membership_enabled',
    'club_join': 'membership_enabled',
    'member_joined': 'membership_enabled',
    'invite_accepted': 'membership_enabled',
    'join_request': 'membership_enabled',
    'join_request_approved': 'membership_enabled',
    'join_request_denied': 'membership_enabled',
    'join_request_processed': 'membership_enabled',
    'role_assigned': 'membership_enabled',
    'role_removed': 'membership_enabled',
    'team_invite': 'membership_enabled',
    // Admin types (matches DB inserts: subscription_expiring, system_announcement, etc.)
    'admin_alert': 'admin_enabled',
    'system_update': 'admin_enabled',
    'system_announcement': 'admin_enabled',
    'subscription_renewed': 'admin_enabled',
    'subscription_expiring': 'admin_enabled',
    'subscription_expired': 'admin_enabled',
    'storage_limit': 'admin_enabled',
    // Pitch board types (matches DB inserts: pitch_board, pending_sub, half_time, formation_change, etc.)
    'pitch_board': 'pitch_board_enabled',
    'pitch_board_update': 'pitch_board_enabled',
    'substitution': 'pitch_board_enabled',
    'substitution_alert': 'pitch_board_enabled',
    'pending_sub': 'pitch_board_enabled',
    'game_started': 'pitch_board_enabled',
    'game_finished': 'pitch_board_enabled',
    'game_ended': 'pitch_board_enabled',
    'half_time': 'pitch_board_enabled',
    'formation_change': 'pitch_board_enabled',
    // Rewards types (matches DB inserts: points_awarded, reward_redeemed, etc.)
    'reward_redeemed': 'rewards_enabled',
    'points_awarded': 'rewards_enabled',
    'reward_available': 'rewards_enabled',
    'early_rsvp_points': 'rewards_enabled',
    'engagement_reminder': 'rewards_enabled',
    'streak_bonus': 'rewards_enabled',
    'streak_progress': 'rewards_enabled',
    'leaderboard_position': 'rewards_enabled',
    'reward_proximity': 'rewards_enabled',
    'weekly_engagement_digest': 'rewards_enabled',
    // POM/Stats types
    'player_of_match': 'pom_enabled',
    'game_stats_ready': 'pom_enabled',
  };
  
  return typeMap[notificationType] || null;
}

// Check if user has enabled this notification type
async function checkUserPreference(
  supabase: any,
  userId: string,
  notificationType: string | undefined
): Promise<boolean> {
  const preferenceColumn = getPreferenceColumn(notificationType);
  
  // If no mapping found, allow the notification (don't block unknown types)
  if (!preferenceColumn) {
    return true;
  }
  
  try {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select(preferenceColumn)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      // If no preferences found, default to true (allow)
      console.log(`[PUSH] No preferences found for user ${userId}, defaulting to enabled`);
      return true;
    }
    
    const isEnabled = data?.[preferenceColumn] ?? true;
    console.log(`[PUSH] User ${userId} preference for ${notificationType} (${preferenceColumn}): ${isEnabled}`);
    return isEnabled;
  } catch (err) {
    console.error('[PUSH] Error checking user preferences:', err);
    return true; // Default to allowing if check fails
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { userId, title, body, url, notificationId, tag, notificationType, data } = await req.json();
    
    console.log(`[PUSH] Starting push notification for user ${userId}, type: ${notificationType || 'unspecified'}`);

    // Reuse module-scope client + env (set at cold start).
    const supabaseUrl = SUPABASE_URL;
    const vapidPublicKey = VAPID_PUBLIC_KEY;
    const vapidPrivateKey = VAPID_PRIVATE_KEY;
    const vapidSubject = VAPID_SUBJECT;
    const supabase = supabaseAdmin;


    // Deduplication: if this notificationId already has a push log entry, skip to prevent
    // duplicate pushes caused by pg_net delivering the same HTTP request twice.
    if (notificationId) {
      const { data: existingLog } = await supabase
        .from('push_notification_logs')
        .select('id')
        .eq('notification_id', notificationId)
        .limit(1)
        .maybeSingle();
      
      if (existingLog) {
        console.log(`[PUSH] Duplicate detected: notification ${notificationId} already has a push log, skipping`);
        return new Response(
          JSON.stringify({ 
            message: 'Duplicate push skipped',
            sent: 0,
            total: 0,
            reason: 'Already processed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Pre-insert a placeholder log to claim this notification and prevent concurrent duplicates
      const { error: claimError } = await supabase
        .from('push_notification_logs')
        .insert({
          notification_id: notificationId,
          user_id: userId,
          endpoint: 'pending',
          status: 'sent',
          status_code: null,
          error_message: null
        });
      
      if (claimError) {
        // If insert fails due to unique constraint, another instance already claimed it
        console.log(`[PUSH] Could not claim notification ${notificationId}, likely already being processed: ${claimError.message}`);
        return new Response(
          JSON.stringify({ 
            message: 'Duplicate push skipped (claim failed)',
            sent: 0,
            total: 0,
            reason: 'Already being processed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Helper: finalize the pre-claimed placeholder row when we early-exit.
    // Without this, the placeholder stays as endpoint='pending', status='sent'
    // forever — misleading data and blocks retry-missed from re-dispatching.
    const finalizePlaceholder = async (status: 'sent' | 'failed' | 'expired' | 'invalid' | 'skipped', endpointLabel: string, errorMsg: string | null) => {
      if (!notificationId) return;
      try {
        await supabase
          .from('push_notification_logs')
          .update({ endpoint: endpointLabel, status, error_message: errorMsg })
          .eq('notification_id', notificationId)
          .eq('endpoint', 'pending');
      } catch (e) {
        console.error('[PUSH] Failed to finalize placeholder', e);
      }
    };

    // Check user preferences before sending
    const shouldSend = await checkUserPreference(supabase, userId, notificationType);
    if (!shouldSend) {
      console.log(`[PUSH] User ${userId} has disabled ${notificationType} notifications, skipping`);
      await finalizePlaceholder('skipped', 'preference-disabled', `User has disabled ${notificationType} notifications`);
      return new Response(
        JSON.stringify({ 
          message: 'Notification skipped - user preference',
          sent: 0,
          total: 0,
          reason: `User has disabled ${notificationType} notifications`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Lock-screen privacy: if user opted out of message previews, redact
    // chat-type notifications to a generic title/body.
    const MESSAGE_TYPES = new Set([
      'team_message','club_message','group_message','direct_message',
      'broadcast','message_reply','message_mention','message_reaction',
      'club_admin_message',
    ]);
    let effectiveTitle = title;
    let effectiveBody = body;
    if (notificationType && MESSAGE_TYPES.has(notificationType)) {
      try {
        const { data: prefRow } = await supabase
          .from('notification_preferences')
          .select('show_message_preview')
          .eq('user_id', userId)
          .maybeSingle();
        const showPreview = (prefRow as any)?.show_message_preview ?? true;
        if (!showPreview) {
          effectiveTitle = 'Ignite';
          effectiveBody = 'New message';
        }
      } catch (err) {
        console.warn('[PUSH] Could not read show_message_preview, defaulting to show:', err);
      }
    }

    // Send to native apps via FCM (parallel with web push)
    const fcmPromise = sendFCMNotifications(
      supabase,
      userId,
      effectiveTitle || 'Ignite',
      effectiveBody || 'You have a new notification',
      url,
      notificationId,
      tag || `notification-${notificationId || Date.now()}`,
      notificationType,
      data
    );
    
    // Check for web push subscriptions
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[PUSH] VAPID keys not configured');
      // Still try FCM
      const fcmResult = await fcmPromise;
      if (fcmResult.sent > 0) {
        await finalizePlaceholder('sent', 'fcm-only', 'VAPID not configured; FCM delivered');
        return new Response(
          JSON.stringify({ 
            message: 'FCM notifications sent',
            sent: fcmResult.sent,
            total: fcmResult.total,
            webPush: { sent: 0, total: 0, error: 'VAPID not configured' }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await finalizePlaceholder('failed', 'config-error', 'VAPID not configured and FCM delivered nothing');
      return new Response(
        JSON.stringify({ error: 'Push notification configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    
    if (subError) {
      console.error('[PUSH] Error fetching subscriptions');
      await finalizePlaceholder('failed', 'subs-fetch-error', 'Failed to fetch push_subscriptions');
      return new Response(
        JSON.stringify({ error: 'An error occurred. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // If no web push subscriptions, just wait for FCM
    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] No web push subscriptions found for user ${userId}`);
      const fcmResult = await fcmPromise;
      
      // Log that we processed this notification (so retry-missed doesn't re-dispatch)
      await logDeliveryStatus(supabase, notificationId, userId, 'fcm-only', fcmResult.sent > 0 ? 'sent' : 'skipped', null, fcmResult.sent > 0 ? null : 'No web push subs, FCM handled');
      
      return new Response(
        JSON.stringify({ 
          message: 'Push notifications processed',
          sent: fcmResult.sent,
          total: fcmResult.total,
          webPush: { sent: 0, total: 0 },
          fcm: fcmResult
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[PUSH] Found ${subscriptions.length} web push subscription(s)`);
    
    const payload = JSON.stringify({
      title: title || 'Ignite',
      body: body || 'You have a new notification',
      url: url || '/notifications',
      notificationId,
      tag: tag || `notification-${notificationId || Date.now()}`,
      notificationType,
      type: notificationType,
      ...(data || {})
    });
    
    let successCount = 0;
    const expiredEndpoints: string[] = [];
    const results: Array<{endpoint: string; status: string; statusCode?: number; retries?: number}> = [];
    
    for (const sub of subscriptions) {
      const endpointShort = sub.endpoint.substring(0, 60) + '...';
      
      // Skip invalid subscriptions (missing keys)
      if (!sub.p256dh || !sub.auth) {
        console.log(`[PUSH] Skipping invalid subscription - missing keys`);
        await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'skipped', null, 'Missing keys');
        results.push({ endpoint: endpointShort, status: 'skipped' });
        continue;
      }

      const result = await sendPushWithRetry(
        sub,
        payload,
        vapidPublicKey,
        vapidPrivateKey,
        vapidSubject
      );

      if (result.success) {
        successCount++;
        console.log(`[PUSH] SUCCESS (attempt ${result.retryCount + 1})`);
        await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'sent', result.statusCode, null, result.retryCount);
        results.push({ 
          endpoint: endpointShort, 
          status: 'sent', 
          statusCode: result.statusCode || undefined,
          retries: result.retryCount 
        });
        
        // Record success in subscription health tracking
        try {
          await supabase.rpc('record_push_success', { p_endpoint: sub.endpoint });
        } catch (e) {
          // Ignore - function may not exist in older deployments
        }
      } else if (result.statusCode === 410 || result.statusCode === 404) {
        console.log(`[PUSH] Subscription EXPIRED`);
        expiredEndpoints.push(sub.id);
        await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'expired', result.statusCode, 'Subscription expired', result.retryCount);
        results.push({ 
          endpoint: endpointShort, 
          status: 'expired', 
          statusCode: result.statusCode || undefined,
          retries: result.retryCount 
        });
      } else {
        console.error(`[PUSH] FAILED: ${result.error}`);
        await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'failed', result.statusCode, result.error || 'Unknown error', result.retryCount);
        results.push({ 
          endpoint: endpointShort, 
          status: 'failed', 
          statusCode: result.statusCode || undefined,
          retries: result.retryCount 
        });
        
        // Record failure in subscription health tracking
        try {
          await supabase.rpc('record_push_failure', { 
            p_endpoint: sub.endpoint, 
            p_reason: result.error || 'Unknown error' 
          });
        } catch (e) {
          // Ignore - function may not exist in older deployments
        }
      }
    }
    
    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', expiredEndpoints);
      console.log(`[PUSH] Cleaned up ${expiredEndpoints.length} expired subscription(s)`);
    }
    
    // Wait for FCM result
    const fcmResult = await fcmPromise;
    
    const totalSent = successCount + fcmResult.sent;
    const totalSubscriptions = subscriptions.length + fcmResult.total;
    
    console.log(`[PUSH] COMPLETE: Web ${successCount}/${subscriptions.length}, FCM ${fcmResult.sent}/${fcmResult.total}`);
    
    return new Response(
      JSON.stringify({ 
        message: 'Push notifications processed',
        sent: totalSent,
        total: totalSubscriptions,
        cleaned: expiredEndpoints.length,
        results,
        webPush: { sent: successCount, total: subscriptions.length },
        fcm: fcmResult
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (err) {
    console.error('[PUSH] FATAL ERROR');
    return new Response(
      JSON.stringify({ error: 'An error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
