import { Actor, HttpAgent } from 'npm:@icp-sdk/core@5/agent';
import { Ed25519KeyIdentity } from 'npm:@icp-sdk/core@5/identity';
import { IDL as CandidIDL } from 'npm:@icp-sdk/core@5/candid';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createNativeQueueAuthority, type NativeQueueActor } from './authority.ts';
import { deliverReservedNativePush } from './delivery.ts';
import { createNativeFcmTransport } from './fcm.ts';
import { nativeSenderSigningSeed } from './signing.ts';
import { drainNativePush } from './drain.ts';

// TEST and LIVE (each pinned to its own Supabase project and queue). Wake-ups are content-free: request bodies and parameters are never
// used for recipients, tokens or text. ICP reservations are the sole authority.
// LIVE covers the base group and the second member group; each queue only
// hands out work once it has commissioned this sender's principal.
const TARGETS: Record<string, string[]> = {
  'https://ecsdwrarzfexssxtrymj.supabase.co': ['jfcdq-yiaaa-aaaal-qxloa-cai'], // TEST
  'https://yabcfiuntwqjwvschnji.supabase.co': ['w263o-3aaaa-aaaai-ayesq-cai', 'zu4gk-vqaaa-aaaal-qxp5a-cai'], // LIVE base + g2
};
const HOST = Deno.env.get('SUPABASE_URL') ?? '';
const QUEUES = TARGETS[HOST];

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
let rerun = false;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!QUEUES) return reply(403, { error: 'Unknown project' });
  const secret = (Deno.env.get('IGNITE_DEV_ICP_PUSH_SENDER_SEED') || Deno.env.get('IGNITE_DEV_ICP_NATIVE_SENDER_KEY'));
  if (!secret) return reply(503, { error: 'Sender identity unavailable' });
  try {
    const identity = Ed25519KeyIdentity.fromSecretKey(await nativeSenderSigningSeed(secret));
    const self = identity.getPrincipal();
    const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
    type Raw = {
      native_push_configuration(): Promise<{ worker: [] | [{ toText(): string }]; enabled: boolean }>;
      reserve_native_push(): Promise<{ Ok: [] | [Record<string, unknown>] } | { Err: string }>;
      settle_native_push(r: string, o: string): Promise<{ Ok: null } | { Err: string }>;
    };
    const queues = QUEUES.map((canisterId) => ({ canisterId,
      raw: Actor.createActor(factory as never, { agent, canisterId }) as unknown as Raw }));
    const configs = await Promise.all(queues.map(async (q) => {
      try { return (await q.raw.native_push_configuration()).worker[0]?.toText() === self.toText(); }
      catch { return false; }
    }));
    const active = queues.filter((_, i) => configs[i]);
    const commissioned = active.length > 0;
    // Public principal only, so the governor can record permission for it.
    if (req.method === 'GET' || !commissioned) return reply(200, { sender: self.toText(), commissioned,
      queues: queues.map((q, i) => ({ queue: q.canisterId, commissioned: configs[i] })) });
    // Reply to the wake-up at once so the ICP caller never times out mid-send;
    // a wake-up during a run asks that run to scan again before it stops.
    if (running) { rerun = true; return reply(202, { busy: true, rescan: true }); }
    running = true;
    const work = (async () => {
      try {
        rerun = false;
        // Each queue drains separately; one queue's stop never blocks another.
        for (const q of active) {
        try {
        const report = await drainNativePush(() => runDelivery(q.raw), () => {
          const requested = rerun;
          rerun = false;
          return requested;
        });
        console.log('Native sender run:', q.canisterId, JSON.stringify(report));
        } catch (error) {
          console.error('Native sender queue stopped:', q.canisterId, error instanceof Error ? error.message.slice(0, 200) : 'unknown');
        }
        }
      } catch (error) {
        console.error('Native sender stopped:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
      } finally { running = false; }
    })();
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime) { runtime.waitUntil(work); return reply(202, { started: true }); }
    await work;
    return reply(200, { started: true });
  } catch (error) {
    console.error('Native sender stopped:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return reply(500, { error: 'Sender stopped; alerts stay held on ICP' });
  }
});

type RawQueue = {
  reserve_native_push(): Promise<{ Ok: [] | [Record<string, unknown>] } | { Err: string }>;
  settle_native_push(r: string, o: string): Promise<{ Ok: null } | { Err: string }>;
};

async function runDelivery(raw: RawQueue) {
  {
    {
      const actor: NativeQueueActor = {
        async reserve_native_push() {
          const r = await raw.reserve_native_push();
          if ('Err' in r) return r;
          return { Ok: r.Ok.map(x => ({ ...x, related_id: x.related_id as string[] })) as never };
        },
        settle_native_push: (r, o) => raw.settle_native_push(r, o),
      };
      const send = createNativeFcmTransport({ supabaseUrl: HOST,
        serviceAccountJson: Deno.env.get('IGNITE_PROD_FCM_SERVICE_ACCOUNT_JSON') ?? '',
        lovableKey: Deno.env.get('LOVABLE_API_KEY') ?? '', connectionKey: Deno.env.get('FIREBASE_MESSAGING_API_KEY') ?? '' });
      return await deliverReservedNativePush(createNativeQueueAuthority(actor), send, 10);
    }
  }
}
