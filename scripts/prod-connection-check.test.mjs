import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROD_CHECK_IDS, assertCheckContext, checkCalls, readerSpec, assessLinks } from './prod-connection-check-policy.mjs';
import { runCheck } from './prod-connection-check.mjs';

const principal = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: principal };

test('preview/main and a DEV canister are rejected before any call', async () => {
  let calls = 0;
  await assert.rejects(runCheck({ ids: PROD_CHECK_IDS, env: { ...env, GITHUB_REF: 'refs/heads/main' }, principal, invoke: () => calls++ }), /prod branch/);
  assert.equal(calls, 0);
  assert.throws(() => assertCheckContext({ ...PROD_CHECK_IDS, club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai' }, env, principal), /exact recorded/);
});

test('all 18 exact PROD IDs and the expected key are required', () => {
  assertCheckContext(PROD_CHECK_IDS, env, principal);
  assert.equal(Object.keys(PROD_CHECK_IDS).length, 18);
  assert.throws(() => assertCheckContext({}, env, principal), /exact recorded/);
  assert.throws(() => assertCheckContext(PROD_CHECK_IDS, env, '2vxsx-fae'), /mismatch/);
});

test('no setter, deployment, proxy, attached cycles or arbitrary method can run', () => {
  const calls = checkCalls(PROD_CHECK_IDS);
  assert.equal(calls.length, 17);
  assert.deepEqual([...new Set(calls.map(c => c.method))].sort(), ['list_groups', 'read_group_opening_configuration', 'read_routing_approval']);
  for (const call of calls) {
    const spec = readerSpec(call, PROD_CHECK_IDS);
    assert.equal(spec.host, 'https://icp-api.io');
    assert.equal(Object.values(PROD_CHECK_IDS).includes(spec.canisterId), true);
    assert.equal('cycles' in spec, false);
  }
  assert.throws(() => readerSpec({ ...calls[0], method: 'set_club_domain_canister' }, PROD_CHECK_IDS), /approved infrastructure/);
  assert.throws(() => readerSpec({ ...calls[0], id: 'mzzzv-taaaa-aaaal-qxlrq-cai' }, PROD_CHECK_IDS), /approved infrastructure/);
  assert.throws(() => readerSpec({ ...calls[0], cycles: 1 }, PROD_CHECK_IDS), /approved infrastructure/);
});

test('concrete PROD links reject missing, duplicate and DEV destinations', () => {
  const good = assessLinks('club_points_domain', [['club_domain', PROD_CHECK_IDS.club_domain]], PROD_CHECK_IDS);
  assert.equal(good[0].matches, true);
  assert.equal(assessLinks('club_points_domain', [['club_domain', 'mzzzv-taaaa-aaaal-qxlrq-cai']], PROD_CHECK_IDS)[0].matches, false);
  assert.equal(assessLinks('club_points_domain', [], PROD_CHECK_IDS)[0].matches, false);
  assert.equal(assessLinks('club_points_domain', [['club_domain', PROD_CHECK_IDS.club_domain], ['club_domain', PROD_CHECK_IDS.club_domain]], PROD_CHECK_IDS)[0].matches, false);
});

test('failed reads are recorded without diagnostic secrets and partial evidence persists', async () => {
  const saved = [];
  const report = await runCheck({ ids: PROD_CHECK_IDS, env, principal,
    invoke: () => { throw new Error('SECRET diagnostic'); }, save: r => saved.push(r.rows.length) });
  assert.equal(report.complete, false);
  assert.equal(report.rows.length, 17);
  assert.equal(saved.length, 17);
  assert.equal(JSON.stringify(report).includes('SECRET'), false);
});

test('workflow is manual, read-only repository access with isolated key cleanup', () => {
  const w = readFileSync(new URL('../.github/workflows/check-prod-canister-connections.yml', import.meta.url), 'utf8');
  assert.match(w, /workflow_dispatch:/);
  assert.doesNotMatch(w, /schedule:|push:|contents: write|icp deploy|supabase|set_app_config/);
  assert.match(w, /contents: read/);
  assert.match(w, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.match(w, /environment: production/);
  assert.match(w, /@icp-sdk\/core@6\.1\.1/);
  assert.match(w, /CHECK_KEY_PEM="\$ICP_HOME\/key\.pem"/);
});
test('failure reasons keep the canister refusal but never paths, keys or encoded blobs', async () => {
  const { failureReason } = await import('./prod-connection-check-policy.mjs');
  const trap = "Error: call to 'x' on tbeh7-5qaaa-aaaai-ayenq-cai was rejected: Error from Canister: Canister called `ic0.trap` with message: 'Governor required'.\nStack backtrace:\n 0: /home/runner/secret";
  assert.equal(failureReason(trap), 'Canister refused: Governor required');
  assert.equal(failureReason('-----BEGIN EC PRIVATE KEY-----\nabc'), 'Tool failed (details withheld)');
  const other = failureReason('Error: failed to load identity at /home/runner/work/_temp/prod-check-identity/key.pem ' + 'A'.repeat(60));
  assert.doesNotMatch(other, /runner|AAAAAAAAAA/);
  assert.equal(failureReason(undefined), 'Tool failed (no details)');
  const agentReject = "The replica returned a rejection error:\n  Request ID: 2457\n  Reject code: 5\n  Reject text: Error from Canister tbeh7-5qaaa-aaaai-ayenq-cai: Canister called `ic0.trap` with message: 'Governor required'.";
  assert.equal(failureReason(agentReject), 'Canister refused: Governor required');
  assert.equal(failureReason('Reject text: Canister w5752 is out of cycles'), 'Rejected: Canister w5752 is out of cycles');
});

test('denied readers report the refusal text', async () => {
  const report = await runCheck({ ids: PROD_CHECK_IDS, env, principal,
    invoke: spec => { if (spec.method === 'read_group_opening_configuration') { const e = new Error('x'); e.stderr = "with message: 'Governor required'"; throw e; } return { Err: 'Forbidden' }; },
    save: () => {} });
  assert.equal(report.rows.at(-1).reason, 'Canister refused: Forbidden');
  assert.equal(report.rows[0].reason, 'Canister refused: Governor required');
  assert.equal(report.complete, false);
});

test('fully wired PROD links read back complete; an unset link is named', async () => {
  const { EXPECTED_LINKS } = await import('./prod-connection-check-policy.mjs');
  const pairs = name => (EXPECTED_LINKS[name] || []).map(k => [k, PROD_CHECK_IDS[k]]);
  const ok = await runCheck({ ids: PROD_CHECK_IDS, env, principal, save: () => {},
    invoke: spec => spec.method === 'read_group_opening_configuration'
      ? pairs(Object.keys(PROD_CHECK_IDS).find(n => PROD_CHECK_IDS[n] === spec.canisterId))
      : { Ok: [] } });
  assert.equal(ok.complete, true);
  const bad = await runCheck({ ids: PROD_CHECK_IDS, env, principal, save: () => {},
    invoke: spec => spec.method === 'read_group_opening_configuration' ? [['club_domain', '']] : { Ok: [] } });
  const pts = bad.rows.find(r => r.name === 'club_points_domain');
  assert.equal(pts.verdict, 'READBACK');
  const blob = bad.rows.find(r => r.name === 'notification_queue');
  assert.equal(blob.verdict, 'LINK_MISMATCH');
  assert.match(blob.reason, /messaging_domain: not set/);
});

test('governor PEM loads as the matching agent identity', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { identityFromPem } = await import('./prod-connection-check.mjs');
  const seen = [];
  const lib = { Secp256k1KeyIdentity: { fromSecretKey: k => (seen.push(['secp', k.length]), 'S') }, Ed25519KeyIdentity: { fromSecretKey: k => (seen.push(['ed', k.length]), 'E') } };
  const ec = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ type: 'sec1', format: 'pem' });
  const ed = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal(identityFromPem(ec, lib), 'S');
  assert.equal(identityFromPem(ed, lib), 'E');
  assert.deepEqual(seen, [['secp', 32], ['ed', 32]]);
});
