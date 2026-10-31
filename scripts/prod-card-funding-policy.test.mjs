import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prodCardPlan, assertNoOpenProdPayment, reconcileDecision,
  PROD_CARD_GATEWAY, PROVISION_MINIMUM_CYCLES,
} from './prod-card-funding-policy.mjs';

const G = 'gwyap-pqop5-msidu-vlkov-zuejr-7gqjr-dwvkx-2yhgy-mdaxt-2giwn-cae';
const OTHER = 'aaaaa-bbbbb-ccccc-ddddd-eefff-ggggg-hhhhh-iiiii-jjjjj-kllll-mae';

test('a card order is refused unless the signer is the declared PROD governor', () => {
  assert.throws(() => prodCardPlan({ paymentId: 'prod-fuel-20261031-01', principal: OTHER, expectedPrincipal: G,
    confirm: 'CREATE CARD LINK', balance: '0', targetT: '20' }), /identity mismatch/);
  assert.throws(() => prodCardPlan({ paymentId: 'prod-fuel-20261031-01', principal: G, expectedPrincipal: '',
    confirm: 'CREATE CARD LINK', balance: '0', targetT: '20' }), /PROD_GOVERNOR_PRINCIPAL/);
});

test('the exact confirmation phrase is required before any order', () => {
  assert.throws(() => prodCardPlan({ paymentId: 'prod-fuel-20261031-01', principal: G, expectedPrincipal: G,
    confirm: 'yes', balance: '0', targetT: '20' }), /confirmation required/);
});

test('the order buys only the gap to the requested fuel target', () => {
  const short = prodCardPlan({ paymentId: 'prod-fuel-20261031-01', principal: G, expectedPrincipal: G,
    confirm: 'CREATE CARD LINK', balance: '5000000000000', targetT: '20' });
  assert.equal(short.shortfallCycles, '15000000000000');
  assert.equal(short.targetCycles, '20000000000000');
  const funded = prodCardPlan({ paymentId: 'prod-fuel-20261031-02', principal: G, expectedPrincipal: G,
    confirm: 'CREATE CARD LINK', balance: '25000000000000', targetT: '20' });
  assert.equal(funded.shortfallCycles, '0');
});

test('a payment ID that is not a safe file name, or a target outside 2–20T, is refused', () => {
  for (const paymentId of ['x', 'PROD_FUEL', 'a'.repeat(49), '../escape', 'prod fuel']) {
    assert.throws(() => prodCardPlan({ paymentId, principal: G, expectedPrincipal: G,
      confirm: 'CREATE CARD LINK', balance: '0', targetT: '20' }), /payment ID/, `accepted ${paymentId}`);
  }
  for (const targetT of ['1', '21', '2.5', 'abc']) {
    assert.throws(() => prodCardPlan({ paymentId: 'prod-fuel-20261031-01', principal: G, expectedPrincipal: G,
      confirm: 'CREATE CARD LINK', balance: '0', targetT }), /fuel target/, `accepted ${targetT}`);
  }
});

test('an unresolved earlier order fences every new order, a closed one does not', () => {
  assert.throws(() => assertNoOpenProdPayment([{ phase: 'checkout-ready' }]), /unresolved/);
  assert.throws(() => assertNoOpenProdPayment([{ phase: 'creating-order' }]), /unresolved/);
  assert.doesNotThrow(() => assertNoOpenProdPayment([{ phase: 'delivered' }, { phase: 'already-funded' }, { phase: 'abandoned' }]));
});

test('reconcile closes a paid order only on balance evidence, never reorders', () => {
  const paid = { phase: 'checkout-ready', plan: { targetCycles: '20000000000000' } };
  assert.deepEqual(reconcileDecision({ state: paid, balance: '20000000000000' }),
    { action: 'deliver', balance: '20000000000000' });
  assert.equal(reconcileDecision({ state: paid, balance: '1000' }).action, 'waiting');
  assert.equal(reconcileDecision({ state: { phase: 'delivered', plan: { targetCycles: '1' } }, balance: '1' }).action, 'closed');
  assert.throws(() => reconcileDecision({ state: undefined, balance: '1' }), /No saved PROD funding record/);
  assert.throws(() => reconcileDecision({ state: { phase: 'refunded', plan: { targetCycles: '1' } }, balance: '1' }), /phase refunded/);
});

test('provisioning floor matches 18 canisters at 1T fuel plus creation fees', () => {
  assert.equal(PROVISION_MINIMUM_CYCLES, 19_800_000_000_000n);
  assert.equal(PROD_CARD_GATEWAY, '2bwus-iiaaa-aaaac-bee3a-cai');
});
