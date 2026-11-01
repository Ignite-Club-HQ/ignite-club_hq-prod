// PROD signing-account card funding: the rules that must hold before a card
// order is created. Pure — no CLI, no network — so the guards are testable.
//
// Why this exists: CyclePay's web page pays cycles into a *canister*, but the
// PROD canister set does not exist until `provision` creates it, and provision
// itself needs cycles. `icp cycles buy` makes the signing identity the buyer,
// so the cycles land on that identity's own Cycles Ledger account and can be
// spent by `icp deploy` — no canister ID needed. The order must therefore be
// signed by the PROD governor and by nothing else: a DEV key buying PROD fuel
// would leave the money in an account that can never create the live set.
import { parseBalance } from './media-card-funding-policy.mjs';

export const PROD_CARD_GATEWAY = '2bwus-iiaaa-aaaac-bee3a-cai'; // CyclePay backend canister (mainnet, USD)
export const PROD_FUNDING_BRANCH = 'ignite-prod-funding-receipts';
export const PROD_FUNDING_DIR = 'deploy/prod-funding';
export const T = 1_000_000_000_000n;
/** 18 PROD canisters × 1T initial fuel + 0.1T creation fee each, rounded down to a floor. */
export const PROVISION_MINIMUM_CYCLES = 19_800_000_000_000n;
export const CLOSED_PHASES = ['delivered', 'already-funded', 'abandoned'];

export function prodCardPlan({ paymentId, principal, expectedPrincipal, confirm, balance, targetT }) {
  // The payment ID becomes a file name on the receipts branch.
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(paymentId ?? '')) {
    throw new Error('Unique 3–48 character PROD payment ID required: lowercase letters, digits and hyphens, e.g. prod-fuel-20261031-01');
  }
  if (confirm !== 'CREATE CARD LINK') throw new Error('Explicit card-link confirmation required');
  const expected = String(expectedPrincipal ?? '').trim();
  if (!expected) throw new Error('Repository variable PROD_GOVERNOR_PRINCIPAL is not set');
  if (principal !== expected) throw new Error('PROD signing identity mismatch; no card order created');
  if (!/^(?:[2-9]|1[0-9]|2[0-2])$/.test(String(targetT))) throw new Error('Choose a 2–22T fuel target');
  const current = BigInt(balance);
  if (current < 0n) throw new Error('Invalid balance');
  const target = BigInt(targetT) * T;
  return {
    paymentId, principal, targetT: String(targetT),
    targetCycles: target.toString(),
    balanceBefore: current.toString(),
    shortfallCycles: (target > current ? target - current : 0n).toString(),
  };
}

/** A card order whose delivery was never confirmed stays fenced: no second order. */
export function assertNoOpenProdPayment(records) {
  if (records.some((r) => !CLOSED_PHASES.includes(r.phase))) {
    throw new Error('An earlier PROD payment is unresolved. Use its saved link, or reconcile it by payment ID; never create another order.');
  }
}

/** Reconcile decision: only a paid-but-unconfirmed order may close, and only on balance evidence. */
export function reconcileDecision({ state, balance }) {
  if (!state) throw new Error('No saved PROD funding record; nothing to reconcile');
  if (CLOSED_PHASES.includes(state.phase)) return { action: 'closed', phase: state.phase };
  if (!['checkout-ready', 'creating-order', 'processing'].includes(state.phase)) {
    throw new Error(`PROD funding record is in phase ${state.phase}; review the receipt before any further action`);
  }
  const have = BigInt(balance);
  const target = BigInt(state.plan.targetCycles);
  return have >= target ? { action: 'deliver', balance: have.toString() } : { action: 'waiting', balance: have.toString(), target: target.toString() };
}

export { parseBalance };
