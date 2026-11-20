// Governor-only switch for all-member native push on the live alert queue.
// inspect reads only; disable is the emergency off-switch.
// Enabling all-member native push stays held until the separate PROD rollout.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { identityFromPem } from './prod-connection-check.mjs';

export const LIVE_QUEUE = 'w263o-3aaaa-aaaai-ayesq-cai';
// Second member group's queue: commissioned with the base queue's own sender.
export const LIVE_GROUP_QUEUES = Object.freeze(['vnmx4-kyaaa-aaaai-aye2a-cai']);
const PROD_ROUTER_ID = 'tgfbl-qiaaa-aaaai-ayena-cai';
export const CONFIRMATIONS = { enable: 'ENABLE PUSH FOR ALL MEMBERS', disable: 'DISABLE PUSH FOR ALL MEMBERS' };

export function assertRequest(action, confirmation) {
  if (!['inspect', 'enable', 'disable'].includes(action)) throw new Error('Only inspect, enable or disable supported');
  if (action === 'enable') throw new Error('All-member PROD native push enable is held until an independently approved PROD G2 security release');
  if (action !== 'inspect' && confirmation !== CONFIRMATIONS[action]) throw new Error(`Exact confirmation required: ${CONFIRMATIONS[action]}`);
}

/** Match pinned PROD group identities to the reviewed governor-signed routing snapshot.
 * An unreviewed snapshot change must block any manual governor action.
 */
export function readProdPushSnapshot() {
  const source = readFileSync(new URL('../frontend/src/live/generated/routingGates.ts', import.meta.url), 'utf8');
  const start = source.indexOf('= {');
  const end = source.lastIndexOf(';');
  if (start < 0 || end <= start) throw new Error('PROD routing snapshot not parseable; refusing push action');
  return JSON.parse(source.slice(start + 2, end).trim());
}

export function assertSafeProdPushTargets(snapshot = readProdPushSnapshot()) {
  if (snapshot?.approved !== true || snapshot.targetAlias !== 'mainnet' ||
      snapshot.host !== 'https://icp-api.io' || snapshot.routerCanisterId !== PROD_ROUTER_ID ||
      !Array.isArray(snapshot.groups) || snapshot.groups.length !== 2 ||
      snapshot.groups.map(g => g.id).sort().join(',') !== 'base,g2') {
    throw new Error('PROD routing topology does not match the reviewed base/G2 snapshot');
  }
  const queue = id => {
    const domains = snapshot.groups.find(g => g.id === id)?.domains;
    if (!Array.isArray(domains)) throw new Error('PROD group domains unavailable');
    const matches = domains.filter(d => d.domain === 'notification_queue');
    if (matches.length !== 1) throw new Error('PROD notification queue identity is missing or ambiguous');
    return matches[0].canisterId;
  };
  if (queue('base') !== LIVE_QUEUE || queue('g2') !== LIVE_GROUP_QUEUES[0] ||
      LIVE_GROUP_QUEUES.length !== 1 || new Set([LIVE_QUEUE, ...LIVE_GROUP_QUEUES]).size !== 2) {
    throw new Error('PROD native push queue mismatch; refusing all governor actions');
  }
  return true;
}

export const idlFactory = ({ IDL }) => IDL.Service({
  native_push_rollout: IDL.Func([], [IDL.Opt(IDL.Record({ enabled: IDL.Bool, started_at_ms: IDL.Nat64 }))], ['query']),
  native_push_configuration: IDL.Func([], [IDL.Record({ worker: IDL.Opt(IDL.Principal), queue: IDL.Principal, enabled: IDL.Bool })], ['query']),
  configure_native_push_worker: IDL.Func([IDL.Principal], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  configure_native_push_rollout: IDL.Func([IDL.Bool, IDL.Principal], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
});

async function main() {
  const env = process.env;
  assertRequest(env.ROLLOUT_ACTION, env.CONFIRMATION);
  assertSafeProdPushTargets();
  const require = createRequire(`${env.CHECK_DEPS_DIR}/package.json`);
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  if (env.PROD_GOVERNOR_PRINCIPAL && identity.getPrincipal().toText() !== env.PROD_GOVERNOR_PRINCIPAL) throw new Error('Signing key is not the recorded governor');
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const base = Actor.createActor(idlFactory, { agent, canisterId: LIVE_QUEUE });
  const baseCfg = await base.native_push_configuration();
  for (const canisterId of [LIVE_QUEUE, ...LIVE_GROUP_QUEUES]) {
    const q = canisterId === LIVE_QUEUE ? base : Actor.createActor(idlFactory, { agent, canisterId });
    const show = async (label) => {
      const r = await q.native_push_rollout();
      console.log(`${canisterId} ${label}: ${r.length ? (r[0].enabled ? 'ON for all members' : 'OFF (pilot only)') : 'OFF (never switched)'}`);
      return r;
    };
    await show('Before');
    if (env.ROLLOUT_ACTION === 'inspect') { const c = await q.native_push_configuration(); console.log(`${canisterId} sender: ${c.worker.length ? 'linked' : 'not linked'}`); continue; }
    if (!baseCfg.enabled || !baseCfg.worker.length) throw new Error('Live sender is not configured; refusing');
    const sender = baseCfg.worker[0];
    let cfg = await q.native_push_configuration();
    if (!cfg.worker.length && env.ROLLOUT_ACTION === 'enable') {
      const linked = await q.configure_native_push_worker(sender);
      if ('Err' in linked) throw new Error(`${canisterId} refused sender link: ${linked.Err}`);
      cfg = await q.native_push_configuration();
    }
    if (!cfg.worker.length) { if (env.ROLLOUT_ACTION === 'disable') continue; throw new Error(`${canisterId} sender not linked`); }
    if (cfg.worker[0].toText() !== sender.toText()) throw new Error(`${canisterId} has a different sender; refusing`);
    const res = await q.configure_native_push_rollout(env.ROLLOUT_ACTION === 'enable', sender);
    if ('Err' in res) throw new Error(`${canisterId} refused: ${res.Err}`);
    const after = await show('After');
    const want = env.ROLLOUT_ACTION === 'enable';
    if (!after.length || after[0].enabled !== want) throw new Error('Readback did not match');
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
