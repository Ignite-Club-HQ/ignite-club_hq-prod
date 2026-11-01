import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROD_CHECK_IDS, assertCheckContext, checkCalls, callArguments, assessLinks } from './prod-connection-check-policy.mjs';
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
    const args = callArguments(call, PROD_CHECK_IDS);
    assert.equal(args.includes('--proxy'), false);
    assert.equal(args.includes('--cycles'), false);
    assert.equal(args[args.indexOf('-n') + 1], 'ic');
  }
  assert.throws(() => callArguments({ ...calls[0], method: 'set_club_domain_canister' }, PROD_CHECK_IDS), /approved infrastructure/);
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
    invoke: () => { throw new Error('SECRET diagnostic'); }, decode: () => [], save: r => saved.push(r.rows.length) });
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
  assert.match(w, /@icp-sdk\/icp-cli@1\.7\.0/);
});
test('failure reasons keep the canister refusal but never paths, keys or encoded blobs', async () => {
  const { failureReason, hexReply } = await import('./prod-connection-check-policy.mjs');
  const trap = "Error: call to 'x' on tbeh7-5qaaa-aaaai-ayenq-cai was rejected: Error from Canister: Canister called `ic0.trap` with message: 'Governor required'.\nStack backtrace:\n 0: /home/runner/secret";
  assert.equal(failureReason(trap), 'Canister refused: Governor required');
  assert.equal(failureReason('-----BEGIN EC PRIVATE KEY-----\nabc'), 'Tool failed (details withheld)');
  const other = failureReason('Error: failed to load identity at /home/runner/work/_temp/prod-check-identity/key.pem ' + 'A'.repeat(60));
  assert.doesNotMatch(other, /runner|AAAAAAAAAA/);
  assert.equal(failureReason(undefined), 'Tool failed (no details)');
  assert.equal(hexReply('A newer version is available\n4449444c00'), '4449444c00');
  assert.throws(() => hexReply('not hex'), /Unexpected/);
});

test('denied router readers report the refusal text', async () => {
  const report = await runCheck({ ids: PROD_CHECK_IDS, env, principal,
    invoke: args => args[3] === 'read_group_opening_configuration' ? '' : '(variant { Err = "Forbidden" })',
    decode: () => { const e = new Error('x'); e.stderr = "with message: 'Governor required'"; throw e; }, save: () => {} });
  assert.equal(report.rows.at(-1).reason, 'Canister refused: Forbidden');
  assert.equal(report.rows[0].reason, 'Canister refused: Governor required');
});

test('configuration replies decode with the pinned Candid library (no Buffer pool offset)', async () => {
  const { replyBytes, internalReason } = await import('./prod-connection-check-policy.mjs');
  const bytes = replyBytes('0x4449444c016d6c0200710171010002' + '0b636c75625f646f6d61696e' + '03616263' + '0178' + '0179');
  assert.equal(bytes.byteOffset, 0);
  assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype);
  assert.equal(bytes[0], 0x44);
  assert.equal(internalReason(new Error('Wrong magic number: "/"')), 'Reply could not be decoded');
  assert.equal(internalReason(new Error('SECRET diagnostic')), '');
});
