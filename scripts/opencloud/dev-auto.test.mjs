import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activation, guard, plan, upgradeArgs, previewEnv, execute, summary } from './dev-auto.mjs';

const config = JSON.parse(readFileSync(new URL('../../deploy/opencloud/dev.json', import.meta.url)));
const peer = JSON.parse(readFileSync(new URL('../../deploy/opencloud/prod.json', import.meta.url)));
const on = { ...config, activation: { lovableRouting: true, autoDeploy: true } };

test('both switches stay off in the committed DEV configuration', () => {
  assert.deepEqual(activation(config), { lovableRouting: false, autoDeploy: false });
  assert.equal(previewEnv(config, 'k'), null);
  assert.throws(() => activation({ activation: { autoDeploy: 'yes' } }));
});

test('only main, opencloud-dev and the exact 32 targets are accepted', () => {
  assert.equal(guard({ config, peer, branch: 'main' }).length, 32);
  assert.throws(() => guard({ config, peer, branch: 'prod' }));
  assert.throws(() => guard({ config: peer, peer: config, branch: 'main' }));
  const mainnet = new Set([config.shared.identity_access]);
  assert.throws(() => guard({ config, peer, branch: 'main', forbidden: mainnet }));
});

test('a group service change upgrades it in both groups; shared changes upgrade all 31', () => {
  const rows = guard({ config, peer, branch: 'main' });
  const one = plan(rows, ['backend/club_domain/src/main.mo']);
  assert.deepEqual(one.targets.map(t => t.name), ['g1_club_domain', 'g2_club_domain']);
  assert.equal(one.frontend, false);
  assert.equal(plan(rows, ['backend/shared/x.rs']).targets.length, 31);
  const all = plan(rows, null).targets;
  assert.equal(all.length, 31); assert.equal(all[0].service, 'identity_access'); assert.equal(all.at(-1).service, 'shard_router');
  assert.equal(plan(rows, ['frontend/src/App.tsx']).frontend, true);
  assert.equal(plan(rows, ['frontend/src/a.test.ts']).frontend, false);
});

test('install commands are upgrade-only and keep Motoko memory', () => {
  const row = { id: config.groups[0].canisterIds.club_domain, service: 'club_domain', name: 'g1_club_domain' };
  const args = upgradeArgs(row, { ...row, moduleSha256: 'a'.repeat(64), upgradePersistence: 'keep' }, '/w.gz');
  assert.equal(args[args.indexOf('--mode') + 1], 'upgrade');
  assert.equal(args[args.indexOf('--proxy') + 1], config.operatorId);
  assert.equal(args[args.indexOf('--wasm-memory-persistence') + 1], 'keep');
  assert.throws(() => upgradeArgs(row, { ...row, id: 'other', moduleSha256: 'a'.repeat(64) }, '/w'));
});

test('execution stops at the first hash mismatch and reports commit and canisters', () => {
  const rows = guard({ config, peer, branch: 'main' });
  const targets = plan(rows, ['backend/club_domain/x']).targets;
  const manifest = { canisters: targets.map(t => ({ id: t.id, service: t.service, wasm: 'a.gz', moduleSha256: 'b'.repeat(64), upgradePersistence: 'keep' })) };
  const calls = [];
  const run = (cmd, args) => { assert.equal(args[args.indexOf('--proxy') + 1], config.operatorId); calls.push(args[1]); return args[1] === 'status' ? `{"module_hash":"${'c'.repeat(64)}"}` : ''; };
  const r = execute({ targets, manifest, work: '/w', run });
  assert.equal(r.ok, false); assert.equal(r.results.length, 1); assert.equal(calls.filter(c => c === 'install').length, 1);
  const text = summary({ commit: 'abc123', results: r.results });
  assert.match(text, /abc123/); assert.match(text, /g1_club_domain/);
});

test('switched-on preview uses the exact engine host and 32-canister inventory', () => {
  const env = previewEnv(on, 'anon');
  assert.equal(env.IGNITE_LIVE_ICP_HOST, config.apiHost);
  assert.equal(Object.keys(JSON.parse(env.IGNITE_LIVE_OPENCLOUD_IDS_JSON)).length, 32);
  assert.equal(env.IGNITE_LIVE_II_DERIVATION_ORIGIN, `https://${config.shared.frontend}.icp.net`);
});
