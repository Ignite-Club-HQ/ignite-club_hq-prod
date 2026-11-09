// Server-only transport. No public endpoint, scheduler, queue claim or email fallback.
const GATEWAY = 'https://connector-gateway.lovable.dev/firebase_messaging/v1/projects/_/messages:send';
const DEV_PROJECT = 'ecsdwrarzfexssxtrymj';
const PROD_PROJECT = 'yabcfiuntwqjwvschnji';
const PROD_FIREBASE = 'ignite-club-hq';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type Config = { supabaseUrl: string; lovableKey?: string; connectionKey?: string; serviceAccountJson?: string };

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let cachedOauth = { token: '', exp: 0 };
async function googleToken(sa: ServiceAccount, request: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedOauth.token && cachedOauth.exp > now + 120) return cachedOauth.token;
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await request('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64u(sig)}`,
    signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`);
  const data = await res.json();
  cachedOauth = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return cachedOauth.token;
}

/** Selects TEST (Lovable Firebase gateway) or LIVE (direct FCM with the live service account). */
export function createNativeFcmTransport(config: Config, request: typeof fetch = fetch) {
  if (config.supabaseUrl === `https://${DEV_PROJECT}.supabase.co`) return createDevFcmTransport(config, request);
  if (config.supabaseUrl !== `https://${PROD_PROJECT}.supabase.co` || !config.serviceAccountJson) {
    throw new Error('Live notification transport is not configured');
  }
  const sa = JSON.parse(config.serviceAccountJson) as ServiceAccount;
  if (sa.project_id !== PROD_FIREBASE || !sa.client_email || !sa.private_key) throw new Error('Live Firebase account mismatch');
  return createEnvelopeTransport(async (body) => request(`https://fcm.googleapis.com/v1/projects/${PROD_FIREBASE}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await googleToken(sa, request)}`, 'Content-Type': 'application/json' },
    body, signal: AbortSignal.timeout(15000) }));
}
type Device = { user: string; platform: string; token: string; active: boolean };
type Payload = { data: Record<string, string>; notification: { title: string; body: string }; android?: unknown; apns?: unknown };

export function createDevFcmTransport(config: Config, request: typeof fetch = fetch) {
  if (config.supabaseUrl !== `https://${DEV_PROJECT}.supabase.co` || !config.lovableKey || !config.connectionKey) {
    throw new Error('TEST notification transport is not configured');
  }
  return createEnvelopeTransport((body) => request(GATEWAY, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.lovableKey}`, 'X-Connection-Api-Key': config.connectionKey!, 'Content-Type': 'application/json' },
    body, signal: AbortSignal.timeout(15000),
  }));
}

function createEnvelopeTransport(post: (body: string) => Promise<Response>) {
  return async (device: Device, payload: Payload) => {
    if (!device.active || !['android', 'ios'].includes(device.platform) || !device.token || device.token.length > 4096 ||
      payload.data.ignite_backend !== 'icp-dev' || payload.data.recipient !== device.user ||
      !payload.data.notification_id || !payload.data.kind || !payload.data.url ||
      !payload.data.url.startsWith('/') || payload.data.url.startsWith('//') ||
      Object.keys(payload.data).some(key => !['ignite_backend', 'recipient', 'notification_id', 'kind', 'url'].includes(key)) ||
      Object.values(payload.data).some(value => typeof value !== 'string' || value.length > 2048) ||
      payload.notification.title !== 'Ignite Club HQ' || payload.notification.body !== 'You have a new update.') {
      throw new Error('TEST notification envelope refused');
    }
    // Do not forward caller-supplied native options or private text.
    const message = {
      token: device.token,
      notification: { title: 'Ignite Club HQ', body: 'You have a new update.' },
      data: payload.data,
      android: { priority: 'HIGH', notification: { channel_id: 'default', tag: payload.data.notification_id } },
      apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert' }, payload: { aps: { sound: 'default' } } },
    };
    // Timeout/transport ambiguity propagates to the durable delivery core's hold,
    // never an automatic repeat. This transport performs exactly one request.
    const response = await post(JSON.stringify({ message }));
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    // Preserve provider status/body for the private orchestration layer; never log
    // tokens, headers or provider bodies here. A successful malformed response is
    // uncertain, not a definite failure suitable for resend.
    if (!response.ok) return { ok: false, status: response.status, body, details: text };
    if (!body || typeof body !== 'object' || !('name' in body) || typeof body.name !== 'string' || !body.name.startsWith('projects/')) {
      throw new Error('TEST notification acceptance could not be confirmed');
    }
    return { ok: true, status: response.status };
  };
}