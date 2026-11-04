/** PROD group opening: preview (read-only), open or close one registered group.
 * Changes exactly one router field (group.accepting) with a revision CAS, then
 * reads it back. Never touches clubs, members, data, code or fuel. The paused
 * removal protocol is not required on PROD (owner decision); the creator
 * placement binding and account link are checked by produce-routing-gates.
 * Usage: tsx scripts/prod-open-group.ts <preview|open|close> <groupId> <operator.pem> <report.json>
 * Env: IGNITE_ICP_ENV=prod, PROD_GOVERNOR_PRINCIPAL, CONFIRMATION for open/close. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';

const [action, groupId, pem, out] = process.argv.slice(2);
if (process.env.IGNITE_ICP_ENV !== 'prod') throw new Error('PROD only');
if (!['preview', 'open', 'close'].includes(action) || !/^[a-z0-9_-]{1,32}$/.test(groupId ?? '') || !pem || !out) {
  throw new Error('Usage: prod-open-group <preview|open|close> <groupId> <operator.pem> <report.json>');
}
const GOVERNOR = process.env.PROD_GOVERNOR_PRINCIPAL ?? '';
if (!GOVERNOR) throw new Error('PROD_GOVERNOR_PRINCIPAL required');
const CONFIRM = { open: `OPEN ${groupId.toUpperCase()} TO NEW CLUBS`, close: `CLOSE ${groupId.toUpperCase()} TO NEW CLUBS` } as Record<string, string>;
if (action in CONFIRM && process.env.CONFIRMATION?.trim() !== CONFIRM[action]) throw new Error(`Exact confirmation required: ${CONFIRM[action]}`);

const ids = JSON.parse(readFileSync(new URL('../../deploy/prod/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
const routerId = ids.shard_router as string;
if (!routerId) throw new Error('PROD router mapping missing');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('PROD governor key required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: Principal.fromText(routerId) });
const ok = <T>(r: { Ok: T } | { Err: string }): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const save = (v: unknown) => { mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x, 2)); };
const read = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));

const registry = await read();
const group = registry.groups.find(g => g.id === groupId);
if (!group) throw new Error(`Group ${groupId} is not registered; registered: ${registry.groups.map(g => g.id).join(', ')}`);
const summary = registry.groups.map(g => `${g.id}=${g.accepting ? 'open' : 'closed'}`).join(' ');
const want = action === 'open';

if (action === 'preview') {
  save({ action, registryRevision: registry.revision, groups: summary, change: { group: groupId, accepting: { from: group.accepting, to: true } } });
  console.log(`PREVIEW revision ${registry.revision}: ${summary}`);
  console.log(group.accepting ? `${groupId} is already open; opening would change nothing.`
    : `Opening ${groupId} changes one router field: accepting false -> true (revision ${registry.revision} -> next). No clubs, members, data, code or fuel change.`);
  process.exit(0);
}
if (group.accepting === want) { console.log(`${groupId} is already ${want ? 'open' : 'closed'}; nothing changed.`); process.exit(0); }
save({ action, pending: true, expectedRevision: registry.revision });
const revision = ok(await router.register_group({ ...group, accepting: want }, registry.revision));
const after = (await read()).groups.find(g => g.id === groupId);
if (!after || after.accepting !== want) throw new Error('Readback failed; reconcile manually, do not replay');
save({ action, revision, accepting: want });
console.log(`${groupId} is now ${want ? 'OPEN' : 'CLOSED'} to new clubs at revision ${revision}. Existing clubs unchanged.`);
