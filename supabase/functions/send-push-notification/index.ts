import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  responseHeaders,
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  checkRequestSize,
  MAX_REQUEST_SIZES,
  SAFE_ERROR_MESSAGES,
} from "../_shared/security.ts";

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
    throw new Error('Invalid encoding');
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

  const privateKeyBytes = base64UrlToUint8Array(privateKeyBase64);
  const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64);
  
  if (publicKeyBytes.length !== 65) {
    throw new Error('Invalid key configuration');
  }
  
  if (privateKeyBytes.length !== 32) {
    throw new Error('Invalid key configuration');
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
  errorMessage: string | null
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
        error_message: errorMessage?.substring(0, 1000)
      });
    
    if (error) {
      console.error('Failed to log push delivery status');
    }
  } catch (err) {
    console.error('Error logging push delivery');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Check request size to prevent memory exhaustion
    if (!checkRequestSize(req, MAX_REQUEST_SIZES.small)) {
      return createErrorResponse(new Error("Request too large"), 413, "Request too large");
    }

    const { userId, title, body, url, notificationId, tag } = await req.json();
    
    console.log(`[PUSH] Starting push notification for user ${userId}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@igniteclubhq.com';
    
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[PUSH] VAPID keys not configured');
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.internal), 500);
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    
    if (subError) {
      console.error('[PUSH] Error fetching subscriptions');
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.internal), 500);
    }
    
    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] No push subscriptions found for user ${userId}`);
      return createSuccessResponse({ message: 'No subscriptions found', sent: 0 });
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
    const failedEndpoints: string[] = [];
    const results: Array<{endpoint: string; status: string; statusCode?: number}> = [];
    
    for (const sub of subscriptions) {
      const endpointShort = sub.endpoint.substring(0, 60) + '...';
      
      try {
        // Skip invalid subscriptions (missing keys)
        if (!sub.p256dh || !sub.auth) {
          console.log(`[PUSH] Skipping invalid subscription`);
          await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'skipped', null, 'Invalid subscription');
          results.push({ endpoint: endpointShort, status: 'skipped' });
          continue;
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
        
        if (response.status === 201 || response.status === 200) {
          successCount++;
          console.log(`[PUSH] SUCCESS`);
          await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'sent', response.status, null);
          results.push({ endpoint: endpointShort, status: 'sent', statusCode: response.status });
        } else if (response.status === 410 || response.status === 404) {
          console.log(`[PUSH] Subscription EXPIRED`);
          failedEndpoints.push(sub.id);
          await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'expired', response.status, 'Subscription expired');
          results.push({ endpoint: endpointShort, status: 'expired', statusCode: response.status });
        } else {
          console.error(`[PUSH] FAILED with status ${response.status}`);
          await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'failed', response.status, 'Push failed');
          results.push({ endpoint: endpointShort, status: 'failed', statusCode: response.status });
        }
        
      } catch (err) {
        console.error(`[PUSH] ERROR`);
        await logDeliveryStatus(supabase, notificationId, userId, sub.endpoint, 'failed', null, 'Processing error');
        results.push({ endpoint: endpointShort, status: 'failed' });
      }
    }
    
    // Clean up expired subscriptions
    if (failedEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', failedEndpoints);
      console.log(`[PUSH] Cleaned up ${failedEndpoints.length} expired subscription(s)`);
    }
    
    console.log(`[PUSH] COMPLETE: ${successCount}/${subscriptions.length} sent successfully`);
    
    return createSuccessResponse({ 
      message: 'Push notifications processed',
      sent: successCount,
      total: subscriptions.length,
      cleaned: failedEndpoints.length,
      results
    });
    
  } catch (err) {
    console.error('[PUSH] FATAL ERROR');
    return createErrorResponse(err, 500);
  }
});
