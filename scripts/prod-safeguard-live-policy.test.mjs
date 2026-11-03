import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeguardContext, publicPins, assertGroupsClosed, stepState, assertWitnessState, identityPinEnv, assertSamePlan,
  SAFEGUARD_CONFIRMATION } from './prod-safeguard-live-policy.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';

const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod',
  GITHUB_SHA: 'a'.repeat(40), CONFIRMATION: SAFEGUARD_CONFIRMATION, SAFEGUARD_JOB: 'create', PROD_GOVERNOR_PRINCIPAL: 'gov-p' };
const key = (role, c) => ({ version: 1, role, phase: 'encrypted-ready', publicKey: c.repeat(64), principal: `${role}-p` });
const pins = publicPins(key('account', 'a'), key('recovery', 'b'), env);
const receipt = { version: 1, phase: 'witness-installed', pending: null, pins, sourceCommit: 'c'.repeat(40),
  witness: 'zzzzz-aaaaa-aaaaa-aaaaa-cai', witnessModuleHash: 'd'.repeat(64), subnet: 's', identity: PROD_CHECK_IDS.identity_access, governor: 'gov-p' };

test('only the exact live prod context and confirmation run', () => {
  assertSafeguardContext(env);
  assert.throws(() => assertSafeguardContext({ ...env, GITHUB_REF: 'refs/heads/main' }));
  assert.throws(() => assertSafeguardContext({ ...env, CONFIRMATION: 'yes' }));
  assert.throws(() => assertSafeguardContext({ ...env, SAFEGUARD_JOB: 'open' }));
});

test('pins require two distinct completed keys, never the governor', () => {
  assert.equal(pins.recoveryPrincipal, 'recovery-p');
  assert.throws(() => publicPins(key('account', 'a'), key('recovery', 'a'), env));
  assert.throws(() => publicPins(key('account', 'a'), { ...key('recovery', 'b'), principal: 'gov-p' }, env));
  assert.throws(() => publicPins(key('account', 'a'), { ...key('recovery', 'b'), phase: 'pending' }, env));
});

test('both groups must stay closed', () => {
  assertGroupsClosed({ next_cursor: [], groups: [{ id: 'base', accepting: false }, { id: 'g2', accepting: false }] });
  assert.throws(() => assertGroupsClosed({ groups: [{ id: 'base', accepting: true }, { id: 'g2', accepting: false }] }));
  assert.throws(() => assertGroupsClosed({ groups: [{ id: 'base', accepting: false }] }));
});

test('steps run in order and resume only their own pending intent', () => {
  assert.equal(stepState(null, 'create'), 'run');
  assert.throws(() => stepState(null, 'install'));
  assert.equal(stepState({ phase: 'witness-created' }, 'create'), 'done');
  assert.equal(stepState({ phase: 'witness-created' }, 'install'), 'run');
  assert.throws(() => stepState({ phase: 'witness-created', pending: { kind: 'pin' } }, 'install'));
  assert.equal(stepState({ phase: 'identity-pinned' }, 'pin'), 'done');
});

test('safeguard must be solely recovery-controlled with the reviewed program', () => {
  assertWitnessState({ controllers: ['recovery-p'], moduleHash: 'd'.repeat(64), subnet: 's' }, receipt, { installed: true });
  assert.throws(() => assertWitnessState({ controllers: ['recovery-p', 'gov-p'], moduleHash: 'd'.repeat(64) }, receipt, { installed: true }));
  assert.throws(() => assertWitnessState({ controllers: ['recovery-p'], moduleHash: 'e'.repeat(64) }, receipt, { installed: true }));
  assert.throws(() => assertWitnessState({ controllers: ['recovery-p'], moduleHash: 'd'.repeat(64) }, receipt, { installed: false }));
});

test('identity pins bind the installed witness and both public keys', () => {
  const pinEnv = identityPinEnv(receipt, PROD_CHECK_IDS);
  assert.equal(pinEnv.IGNITE_PRODUCTION_ACCOUNT_WITNESS, receipt.witness);
  assert.equal(pinEnv.IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY, 'a'.repeat(64));
  assert.throws(() => identityPinEnv({ ...receipt, witness: PROD_CHECK_IDS.club_domain }, PROD_CHECK_IDS));
  assert.throws(() => assertSamePlan(receipt, { ...receipt, witnessModuleHash: 'e'.repeat(64) }));
});
