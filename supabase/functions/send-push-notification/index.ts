import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { error } = await supabase
      .from('push_notification_logs')
      .insert({
        notification_id: notificationId,
        user_id: userId,
        endpoint: endpoint.substring(0, 500),
        status,
        status_code: statusCode,
        error_message: errorMessage ? `${errorMessage} (retries: ${retryCount})`.substring(0, 1000) : null
      });
    
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { userId, title, body, url, notificationId, tag } = await req.json();
    
    console.log(`[PUSH] Starting push notification for user ${userId}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@igniteclubhq.com';
    
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[PUSH] VAPID keys not configured');
      return new Response(
        JSON.stringify({ error: 'Push notification configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    
    if (subError) {
      console.error('[PUSH] Error fetching subscriptions');
      return new Response(
        JSON.stringify({ error: 'An error occurred. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] No push subscriptions found for user ${userId}`);
      return new Response(
        JSON.stringify({ message: 'No subscriptions found', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[PUSH] Found ${subscriptions.length} subscription(s)`);
    
    const payload = JSON.stringify({
      title: title || 'Ignite Club HQ',
      body: body || 'You have a new notification',
      url: url || '/notifications',
      notificationId,
      tag: tag || `notification-${notificationId || Date.now()}`
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
    
    console.log(`[PUSH] COMPLETE: ${successCount}/${subscriptions.length} sent successfully`);
    
    return new Response(
      JSON.stringify({ 
        message: 'Push notifications processed',
        sent: successCount,
        total: subscriptions.length,
        cleaned: expiredEndpoints.length,
        results
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
