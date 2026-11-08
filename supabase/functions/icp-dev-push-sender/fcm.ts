// Server-only transport. No public endpoint, scheduler, queue claim or email fallback.
const GATEWAY = 'https://connector-gateway.lovable.dev/firebase_messaging/v1/projects/_/messages:send';
const DEV_PROJECT = 'ecsdwrarzfexssxtrymj';

type Config = { supabaseUrl: string; lovableKey: string; connectionKey: string };
type Device = { user: string; platform: string; token: string; active: boolean };
type Payload = { data: Record<string, string>; notification: { title: string; body: string }; android?: unknown; apns?: unknown };

export function createDevFcmTransport(config: Config, request: typeof fetch = fetch) {
  if (config.supabaseUrl !== `https://${DEV_PROJECT}.supabase.co` || !config.lovableKey || !config.connectionKey) {
    throw new Error('TEST notification transport is not configured');
  }
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
    const response = await request(GATEWAY, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.lovableKey}`, 'X-Connection-Api-Key': config.connectionKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15000),
    });
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