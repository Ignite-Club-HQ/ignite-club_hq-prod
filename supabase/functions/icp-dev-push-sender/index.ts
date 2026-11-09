import { Actor, HttpAgent } from 'npm:@icp-sdk/core@5/agent';
import { Ed25519KeyIdentity } from 'npm:@icp-sdk/core@5/identity';
import { IDL as CandidIDL } from 'npm:@icp-sdk/core@5/candid';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createNativeQueueAuthority, type NativeQueueActor } from './authority.ts';
import { deliverReservedNativePush } from './delivery.ts';
import { createDevFcmTransport } from './fcm.ts';
import { nativeSenderSigningSeed } from './signing.ts';

// TEST only. Wake-ups are content-free: request bodies and parameters are never
// used for recipients, tokens or text. ICP reservations are the sole authority.
const DEV_URL = 'https://ecsdwrarzfexssxtrymj.supabase.co';
const QUEUE = 'jfcdq-yiaaa-aaaal-qxloa-cai';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const factory = ({ IDL }: { IDL: typeof CandidIDL }) => {
  const row = IDL.Record({ receipt: IDL.Text, user: IDL.Text, token: IDL.Text, platform: IDL.Text,
    notification_id: IDL.Text, kind: IDL.Text, related_id: IDL.Opt(IDL.Text), scope: IDL.Text, key: IDL.Text });
  return IDL.Service({
    native_push_configuration: IDL.Func([], [IDL.Record({ worker: IDL.Opt(IDL.Principal), queue: IDL.Principal, enabled: IDL.Bool })], ['query']),
    reserve_native_push: IDL.Func([], [IDL.Variant({ Ok: IDL.Opt(row), Err: IDL.Text })], []),
    settle_native_push: IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  });
};

let running = false;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (Deno.env.get('SUPABASE_URL') !== DEV_URL) return reply(403, { error: 'TEST only' });
  const secret = Deno.env.get('IGNITE_DEV_ICP_NATIVE_SENDER_KEY');
  if (!secret) return reply(503, { error: 'Sender identity unavailable' });
  try {
    const identity = Ed25519KeyIdentity.fromSecretKey(await nativeSenderSigningSeed(secret));
    const self = identity.getPrincipal();
    const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
    const raw = Actor.createActor(factory as never, { agent, canisterId: QUEUE }) as unknown as {
      native_push_configuration(): Promise<{ worker: [] | [{ toText(): string }]; enabled: boolean }>;
      reserve_native_push(): Promise<{ Ok: [] | [Record<string, unknown>] } | { Err: string }>;
      settle_native_push(r: string, o: string): Promise<{ Ok: null } | { Err: string }>;
    };
    const config = await raw.native_push_configuration();
    const commissioned = config.worker[0]?.toText() === self.toText();
    // Public principal only, so the governor can record permission for it.
    if (req.method === 'GET' || !commissioned) return reply(200, { sender: self.toText(), commissioned });
    if (running) return reply(202, { busy: true });
    running = true;
    try {
      const actor: NativeQueueActor = {
        async reserve_native_push() {
          const r = await raw.reserve_native_push();
          if ('Err' in r) return r;
          return { Ok: r.Ok.map(x => ({ ...x, related_id: x.related_id as string[] })) as never };
        },
        settle_native_push: (r, o) => raw.settle_native_push(r, o),
      };
      const send = createDevFcmTransport({ supabaseUrl: DEV_URL,
        lovableKey: Deno.env.get('LOVABLE_API_KEY') ?? '', connectionKey: Deno.env.get('FIREBASE_MESSAGING_API_KEY') ?? '' });
      const report = await deliverReservedNativePush(createNativeQueueAuthority(actor), send, 10);
      return reply(200, report);
    } finally { running = false; }
  } catch (error) {
    console.error('TEST native sender stopped:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return reply(500, { error: 'Sender stopped; alerts stay held on ICP' });
  }
});
