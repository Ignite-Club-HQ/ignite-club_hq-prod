import { Actor, HttpAgent } from 'npm:@icp-sdk/core@5.4.0/agent';
import { Ed25519KeyIdentity } from 'npm:@icp-sdk/core@5.4.0/identity';
import { deliverBrowserSelfTest } from './delivery.ts';

const QUEUE = 'jfcdq-yiaaa-aaaal-qxloa-cai';
const DEV_URL = 'https://ecsdwrarzfexssxtrymj.supabase.co';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST' && request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
  // Caller supplies only an opaque test id. Ownership/consent is established by signed
  // ICP request_browser_push_test; worker-only claim returns its fixed envelope once.
  if (Deno.env.get('SUPABASE_URL') !== DEV_URL) return reply(403, { error: 'TEST only' });
  const seed = Deno.env.get('IGNITE_DEV_ICP_PUSH_WORKER_SEED');
  const key = Deno.env.get('LOVABLE_API_KEY');
  const connection = Deno.env.get('FIREBASE_MESSAGING_API_KEY');
  if (!seed || !/^[a-fA-F0-9]{64}$/.test(seed) || !key || !connection) return reply(503, { error: 'TEST sending setup is not ready' });
  if (request.method === 'GET') return reply(200, { ready: true });
  try {
    const text = await request.text();
    if (text.length > 256) return reply(400, { error: 'Invalid test request' });
    const body = JSON.parse(text);
    if (!body || typeof body.id !== 'string' || Object.keys(body).some(k => k !== 'id')) return reply(400, { error: 'Invalid test request' });
    const identity = Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(seed.match(/.{2}/g) ?? [], x => parseInt(x, 16)));
    const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
    const factory = ({ IDL }: { IDL: typeof import('npm:@icp-sdk/core@5.4.0/candid').IDL }) => {
      const row = IDL.Record({ owner: IDL.Principal, token: IDL.Text, id: IDL.Text, expires: IDL.Nat64, status: IDL.Text, worker: IDL.Opt(IDL.Principal) });
      return IDL.Service({ claim_browser_push_test: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Opt(row), Err: IDL.Text })], []),
        settle_browser_push_test: IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []) });
    };
    const actor = Actor.createActor(factory, { agent, canisterId: QUEUE }) as unknown as {
      claim_browser_push_test: (id: string) => Promise<{ Ok?: { id: string; token: string; owner: { toText(): string } }[]; Err?: string }>;
      settle_browser_push_test: (id: string, outcome: string) => Promise<{ Ok?: null; Err?: string }>;
    };
    const result = await deliverBrowserSelfTest(body.id, {
      claim: async id => {
        const result = await actor.claim_browser_push_test(id);
        if ('Err' in result) throw new Error('TEST claim refused');
        const row = result.Ok?.[0];
        return row ? { id: row.id, token: row.token, owner: row.owner.toText() } : undefined;
      },
      settle: async (id, outcome) => {
        const result = await actor.settle_browser_push_test(id, outcome);
        if ('Err' in result) throw new Error('TEST settlement unconfirmed');
      },
    }, async row => {
      const response = await fetch('https://connector-gateway.lovable.dev/firebase_messaging/v1/projects/_/messages:send', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Connection-Api-Key': connection, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: row.token,
          notification: { title: 'Ignite TEST', body: 'Your TEST browser notification is working.' },
          data: { ignite_backend: 'icp-dev', recipient: row.owner, notification_id: row.id, kind: 'browser_self_test', url: '/notifications' },
          webpush: { headers: { TTL: '60', Urgency: 'high' } } } }), signal: AbortSignal.timeout(15000),
      });
      const providerText = await response.text();
      if (!response.ok) {
        // Preserve provider failure privately; never record registration tokens or auth headers.
        console.error('TEST Firebase refusal', response.status, providerText);
        return false;
      }
      const result = JSON.parse(providerText);
      if (typeof result.name !== 'string' || !result.name.startsWith('projects/')) throw new Error('Unconfirmed provider acceptance');
      return true;
    });
    return reply(200, result);
  } catch {
    return reply(502, { error: 'TEST request could not be confirmed; do not automatically retry' });
  }
});