// Creates ONE card order that credits the PROD governor's own cycles balance,
// waits for delivery, and verifies it. It never calls a canister: no create,
// no top-up, no deploy. The journal record is committed and read back before
// the order is placed, so a lost reply can never trigger a second payment.
import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';
import {
  prodCardPlan, assertNoOpenProdPayment, reconcileDecision, parseBalance,
  PROD_CARD_GATEWAY, PROD_FUNDING_BRANCH, PROD_FUNDING_DIR,
} from './prod-card-funding-policy.mjs';

// Mobile keyboards add surrounding spaces; trim only those, the exact value is still validated.
for (const k of ['PAYMENT_ID', 'CARD_CONFIRM', 'TARGET_T', 'FUNDING_MODE']) if (process.env[k] !== undefined) process.env[k] = process.env[k].trim();
const identity = 'ignite-prod-governor';
const mode = process.env.FUNDING_MODE === 'reconcile' ? 'reconcile' : 'fund';

function cli(args) {
  const r = spawnSync('icp', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ICP ${args.slice(0, 2).join(' ')} failed; no automatic retry: ${(r.stderr || '').trim().slice(-400)}`);
  return r.stdout.trim();
}
function balance() { return parseBalance(cli(['cycles', 'balance', '-n', 'ic', '--identity', identity, '--json'])); }

if (!process.env.GITHUB_REPOSITORY || !process.env.GH_TOKEN || !process.env.FUNDING_REPORT_DIR || !process.env.GITHUB_STEP_SUMMARY) {
  throw new Error('GitHub journal, report directory and summary required');
}
const api = createJournalApi(process.env.GITHUB_REPOSITORY, JSON.stringify);

const refs = api(`git/matching-refs/heads/${PROD_FUNDING_BRANCH}`);
if (!refs.some((r) => r.ref === `refs/heads/${PROD_FUNDING_BRANCH}`)) {
  const base = api(`git/ref/heads/${api('').default_branch}`);
  api('git/refs', 'POST', { ref: `refs/heads/${PROD_FUNDING_BRANCH}`, sha: base.object.sha });
}
const inventory = api(`git/trees/${PROD_FUNDING_BRANCH}?recursive=1`);
if (inventory.truncated) throw new Error('Incomplete funding inventory');

function readWithSha(path) {
  const entry = api(`contents/${path}?ref=${PROD_FUNDING_BRANCH}`);
  const blob = api(`git/blobs/${entry.sha}`);
  if (blob.encoding !== 'base64') throw new Error('Unexpected receipt encoding');
  return { text: Buffer.from(blob.content, 'base64').toString(), sha: entry.sha };
}
const file = `${PROD_FUNDING_DIR}/${process.env.PAYMENT_ID}.json`;
const records = inventory.tree
  .filter((e) => new RegExp(`^${PROD_FUNDING_DIR}/[^/]+\\.json$`).test(e.path))
  .map((e) => JSON.parse(readWithSha(e.path).text));
const existing = inventory.tree.some((e) => e.path === file) ? readWithSha(file) : undefined;

mkdirSync(process.env.FUNDING_REPORT_DIR, { recursive: true });
let sha = existing?.sha;
let state = existing ? JSON.parse(existing.text) : undefined;
function save() {
  const text = JSON.stringify(state, null, 2) + '\n';
  writeFileSync(join(process.env.FUNDING_REPORT_DIR, 'payment.json'), text);
  const result = api(`contents/${file}`, 'PUT', {
    message: `PROD card funding ${state.plan.paymentId}: ${state.phase}`,
    branch: PROD_FUNDING_BRANCH,
    content: Buffer.from(text).toString('base64'),
    ...(sha ? { sha } : {}),
  });
  sha = result.content.sha;
  if (readWithSha(file).text !== text) throw new Error('Funding checkpoint read-back mismatch; never repeat order creation');
}
function summary(text) { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); }

if (mode === 'reconcile') {
  if (!state) throw new Error('No saved PROD funding record for this payment ID; nothing to reconcile');
  const decision = reconcileDecision({ state, balance: balance() });
  if (decision.action === 'closed') {
    summary(`PROD funding ${state.plan.paymentId} is already closed (${state.phase}). No order created, no canister touched.`);
    process.exit(0);
  }
  if (decision.action === 'waiting') {
    summary(`Still waiting on ${state.plan.paymentId}: balance ${decision.balance} of ${decision.target} cycles. Keep the saved link; do not create another order.`);
    throw new Error('PROD card delivery still unresolved; no automatic order replay');
  }
  state.phase = 'delivered';
  state.balanceAfter = decision.balance;
  state.reconciledAt = new Date().toISOString();
  save();
  summary(`PROD funding ${state.plan.paymentId} reconciled as delivered: balance ${decision.balance} cycles. No canister was created or changed.`);
  console.log(`PROD funding ${state.plan.paymentId} delivered; balance ${decision.balance} cycles.`);
  process.exit(0);
}

if (existing) throw new Error('Payment ID already exists on the receipts branch; consult its receipt, never repeat it');
assertNoOpenProdPayment(records);
const plan = prodCardPlan({
  paymentId: process.env.PAYMENT_ID,
  principal: cli(['identity', 'principal', '--identity', identity]),
  expectedPrincipal: process.env.PROD_GOVERNOR_PRINCIPAL,
  confirm: process.env.CARD_CONFIRM,
  balance: balance(),
  targetT: process.env.TARGET_T,
});
state = { plan, phase: 'approved', createdAt: new Date().toISOString() };
summary(`## PROD signing-account card funding: ${plan.paymentId}`);
summary(`Signing identity: \`${plan.principal}\`. Fuel target: ${plan.targetCycles} cycles.`);
summary(`Existing balance: ${plan.balanceBefore}; requested shortfall: ${plan.shortfallCycles} cycles.`);
summary('Checkout quotes USD/card fees at CyclePay\'s protocol rate; nothing is spent on a canister by this run.');

if (plan.shortfallCycles === '0') {
  state.phase = 'already-funded';
  save();
  summary('Already funded: no payment order created. Run `[PROD] Promote ICP canisters to live` with action `provision`.');
} else {
  // Commit and read back intent BEFORE making the order. Unknown replies remain locked.
  state.phase = 'creating-order';
  save();
  const child = spawn('icp', ['cycles', 'buy', '--cycles', plan.shortfallCycles, '-n', 'ic', '--identity', identity,
    '--gateway', PROD_CARD_GATEWAY, '--no-open', '--yes', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let failure;
  const closed = new Promise((resolve) => {
    child.on('error', (error) => { failure = error; resolve(null); });
    child.on('close', resolve);
  });
  lines.on('line', (line) => {
    if (failure) return;
    try {
      const message = JSON.parse(line);
      if (message.checkout_url) {
        const url = new URL(message.checkout_url);
        if (url.protocol !== 'https:' || !['buy.stripe.com', 'checkout.stripe.com'].includes(url.hostname)) throw new Error('Unexpected checkout host; consult the saved order');
        state.order = message;
        state.phase = 'checkout-ready';
        save();
        // Preserve the returned URL verbatim, including underscores and order reference.
        summary(`### [Pay by card](${message.checkout_url})`);
        summary(`Order: \`${message.order_id}\`. Price: ${message.amount?.value} ${message.amount?.currency}; card fee: ${message.fee?.value} ${message.fee?.currency}; estimated cycles: ${message.estimated_cycles}.`);
        summary(`Expires: ${message.expires_at}. Open this link from the running job log now, or refresh the run summary. Do not create another order while waiting.`);
        console.log(`PAY BY CARD: ${message.checkout_url}`);
        console.log(`Order ${message.order_id}; quoted ${message.amount?.value} ${message.amount?.currency}. Waiting for delivery.`);
      } else if (message.status) {
        state.result = message;
        state.phase = message.status;
        save();
        summary(`Payment status: **${message.status}**; delivered cycles: ${message.cycles_delivered ?? 'not confirmed'}.`);
      }
    } catch (error) { failure = error; child.kill('SIGTERM'); }
  });
  const code = await closed;
  if (failure) throw failure;
  if (code !== 0 || state.phase !== 'delivered') {
    summary('Delivery not verified. Keep the existing link/order. Do not rerun to create another payment; reconcile this payment ID instead.');
    throw new Error('PROD card delivery unresolved; no automatic order replay');
  }
  state.balanceAfter = balance().toString();
  state.testReady = BigInt(state.balanceAfter) >= BigInt(plan.targetCycles);
  save();
  summary(state.testReady
    ? `Balance verified: ${state.balanceAfter} cycles. Run \`[PROD] Promote ICP canisters to live\` with action \`provision\`. No canister was created or changed by this run.`
    : `Balance verified: ${state.balanceAfter} cycles, still below the target. No further operation started; review the delivered amount before authorizing another purchase.`);
}
