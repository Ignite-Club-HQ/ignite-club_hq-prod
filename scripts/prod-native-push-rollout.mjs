// Governor-only switch for all-member native push on the live alert queue.
// inspect reads only; enable/disable call configure_native_push_rollout with the
// queue's currently bound sender, then read the state back.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { identityFromPem } from './prod-connection-check.mjs';

export const LIVE_QUEUE = 'w263o-3aaaa-aaaai-ayesq-cai';
export const CONFIRMATIONS = { enable: 'ENABLE PUSH FOR ALL MEMBERS', disable: 'DISABLE PUSH FOR ALL MEMBERS' };

export function assertRequest(action, confirmation) {
  if (!['inspect', 'enable', 'disable'].includes(action)) throw new Error('Only inspect, enable or disable supported');
  if (action !== 'inspect' && confirmation !== CONFIRMATIONS[action]) throw new Error(`Exact confirmation required: ${CONFIRMATIONS[action]}`);
}

export const idlFactory = ({ IDL }) => IDL.Service({
  native_push_rollout: IDL.Func([], [IDL.Opt(IDL.Record({ enabled: IDL.Bool, started_at_ms: IDL.Nat64 }))], ['query']),
  native_push_configuration: IDL.Func([], [IDL.Record({ worker: IDL.Opt(IDL.Principal), queue: IDL.Principal, enabled: IDL.Bool })], ['query']),
  configure_native_push_rollout: IDL.Func([IDL.Bool, IDL.Principal], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
});

async function main() {
  const env = process.env;
  assertRequest(env.ROLLOUT_ACTION, env.CONFIRMATION);
  const require = createRequire(`${env.CHECK_DEPS_DIR}/package.json`);
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  if (env.PROD_GOVERNOR_PRINCIPAL && identity.getPrincipal().toText() !== env.PROD_GOVERNOR_PRINCIPAL) throw new Error('Signing key is not the recorded governor');
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const q = Actor.createActor(idlFactory, { agent, canisterId: LIVE_QUEUE });
  const show = async (label) => {
    const r = await q.native_push_rollout();
    console.log(`${label}: ${r.length ? (r[0].enabled ? 'ON for all members' : 'OFF (pilot only)') : 'OFF (never switched)'}`);
    return r;
  };
  await show('Before');
  if (env.ROLLOUT_ACTION === 'inspect') return;
  const cfg = await q.native_push_configuration();
  if (!cfg.enabled || !cfg.worker.length) throw new Error('Live sender is not configured; refusing');
  const res = await q.configure_native_push_rollout(env.ROLLOUT_ACTION === 'enable', cfg.worker[0]);
  if ('Err' in res) throw new Error(`Queue refused: ${res.Err}`);
  const after = await show('After');
  const want = env.ROLLOUT_ACTION === 'enable';
  if (!after.length || after[0].enabled !== want) throw new Error('Readback did not match');
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
