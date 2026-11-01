// Pure cycles top-up policy for PROD. The planner computes the exact
// per-canister amount needed to bring every group service to its registered
// minimum (plus an explicit reserve). The execution half distributes exactly
// those reviewed amounts through the cycles ledger, checkpointed and
// idempotent, and nothing else: no funding order, no configuration change,
// no registration, no opening, no DEV access. An unreadable balance is
// reported as unknown and excluded from totals — never treated as zero and
// never turned into an inferred payment need.
import { createHash } from 'node:crypto';
import { assertCheckContext } from './prod-connection-check-policy.mjs';
import { expectedServices } from './prod-routing-gate-policy.mjs';
import { normalizeReviewedHash } from './prod-base-group-policy.mjs';
import { CREATE_DEDUP_WINDOW_NS } from './prod-g2-create-policy.mjs';

export const TOPUP_CONFIRMATION = 'TOP UP PROD CANISTERS';
export const TOPUP_RECEIPT_PATH = 'prod-group-setup/cycles-topup.json';
/** Conservative per-deposit ledger fee budget (actual cycles-ledger fee is 100M cycles). */
export const DEPOSIT_FEE_BUDGET = 1_000_000_000n;
export const DEPOSIT_DEDUP_WINDOW_NS = CREATE_DEDUP_WINDOW_NS;

const decimal = n => /^(0|[1-9][0-9]*)$/.test(String(n)) ? String(n) : undefined;
const rows = list => Array.isArray(list) ? list : [];

export function assertTopupContext(ids, env, principal, action = env.TOPUP_ACTION ?? 'plan') {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'topup-closed'].includes(action))
    throw new Error('Only read-only plan or confirmation-gated topup-closed supported');
  if (action === 'topup-closed' && env.CONFIRMATION?.trim() !== TOPUP_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${TOPUP_CONFIRMATION}`);
}

/** Canonical plan text: the volatile observation time is excluded, so the
 * hash binds the inventory, targets and amounts — the things a later
 * top-up step would re-verify — not the moment the plan was read. */
export function hashTopupPlan(plan) {
  const { checkedAt, planHash, ...stable } = plan;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/**
 * Build the top-up plan from already-reduced plain-text evidence.
 * `services` rows: { group, name, id, cycles|null, balanceRead }.
 * `signingAccount`: { balance|null, balanceRead } in cycles.
 * `reserveCycles`: extra margin above each group's registered minimum.
 */
export function planCyclesTopup({ page, services = [], signingAccount = {}, reserveCycles = '0', checkedAt }) {
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  const reserve = decimal(reserveCycles);
  if (reserve === undefined) throw new Error('Reserve must be a non-negative cycle count');
  if (!page) throw new Error('A bounded consensus group registry reply is required');
  if (rows(page.next_cursor).length) throw new Error('Registry exceeds this bounded audit; no whole-inventory claim');
  const groups = rows(page.groups);
  if (!groups.length) throw new Error('No group is registered to plan for');
  const placements = new Map(rows(page.placements).map(p => [p.group_id, p]));
  const observed = new Map(services.map(s => [`${s.group}/${s.name}`, s]));

  const items = [];
  const gaps = [];
  let totalTopUp = 0n;
  let totalBalance = 0n;
  let needsFuel = 0;
  for (const group of groups) {
    const minimum = decimal(group.min_cycles);
    if (minimum === undefined) throw new Error(`Group ${group.id} does not expose a cycle minimum`);
    const target = (BigInt(minimum) + BigInt(reserve)).toString();
    const expected = expectedServices(group, placements.get(group.id));
    for (const item of expected) {
      const service = observed.get(`${group.id}/${item.name}`);
      if (!service || service.id !== item.id) {
        gaps.push({ code: 'SERVICE_UNREADABLE', detail: `${group.id}/${item.name}: management readback missing or differs from the registry.` });
        items.push({ group: group.id, name: item.name, id: item.id, balance: null, target, topUp: null, balanceRead: 'unreadable' });
        continue;
      }
      const balance = decimal(service.cycles);
      if (balance === undefined) {
        items.push({ group: group.id, name: item.name, id: item.id, balance: null, target, topUp: null, balanceRead: 'unreadable' });
        continue;
      }
      const topUp = BigInt(target) > BigInt(balance) ? (BigInt(target) - BigInt(balance)).toString() : '0';
      if (topUp !== '0') needsFuel += 1;
      totalTopUp += BigInt(topUp);
      totalBalance += BigInt(balance);
      items.push({ group: group.id, name: item.name, id: item.id, balance, target, topUp, balanceRead: 'readback' });
    }
  }

  const accountBalance = decimal(signingAccount.balance);
  const account = {
    balance: accountBalance ?? null,
    balanceRead: accountBalance !== undefined ? 'readback' : 'unreadable',
    // Remaining after the planned top-ups; negative means the signing account
    // cannot cover the plan and more funding would be needed first.
    remainingAfter: accountBalance !== undefined ? (BigInt(accountBalance) - totalTopUp).toString() : null,
  };

  const plan = {
    kind: 'prod-cycles-topup-plan',
    checkedAt,
    reserveCycles: reserve,
    groups: groups.map(g => g.id).sort(),
    items,
    totals: {
      canisters: items.length,
      needingFuel: needsFuel,
      totalBalance: totalBalance.toString(),
      totalTopUp: totalTopUp.toString(),
    },
    signingAccount: account,
    gaps,
  };
  return { ...plan, planHash: hashTopupPlan(plan) };
}

const t = cycles => `${(Number(BigInt(cycles) * 1000n / 1000000000000n) / 1000).toFixed(3)}T`;

/** GitHub-step-summary markdown. Exact cycle counts stay in the JSON evidence;
 * the table shows them in full so the owner sees real amounts, not guesses. */
export function topupSummary(plan) {
  const lines = [
    '### PROD cycles top-up plan (read-only)', '',
    `Groups: ${plan.groups.join(', ')} · reserve above each group minimum: ${plan.reserveCycles} cycles`, '',
    '### Per-canister top-up to reach the registered minimum', '',
    '| Group/service | Canister | Balance | Target | Top-up |', '|---|---|---|---|---|',
  ];
  for (const item of plan.items) {
    lines.push(`| ${item.group}/${item.name} | ${item.id} | ${item.balance ?? 'unreadable'} | ${item.target} | ${item.topUp ?? 'excluded'} |`);
  }
  lines.push('', `Total top-up needed: **${plan.totals.totalTopUp} cycles (${t(plan.totals.totalTopUp)})** across ${plan.totals.needingFuel} of ${plan.totals.canisters} canisters.`, '');
  const account = plan.signingAccount;
  if (account.balanceRead === 'readback') {
    lines.push(`Signing account balance: ${account.balance} cycles (${t(account.balance)}).`);
    lines.push(BigInt(account.remainingAfter) >= 0n
      ? `Remaining after the plan: ${account.remainingAfter} cycles (${t(account.remainingAfter)}).`
      : `The signing account is short by ${(-BigInt(account.remainingAfter)).toString()} cycles (${t((-BigInt(account.remainingAfter)).toString())}); more funding would be needed before any top-up.`);
  } else {
    lines.push('Signing account balance: unreadable — coverage of the plan is unknown, not assumed.');
  }
  if (plan.gaps.length) {
    lines.push('', '### Read gaps', ...plan.gaps.map(g => `- ${g.code}: ${g.detail}`));
  }
  lines.push('',
    'This is an exact execution-fuel computation from live balances, not a payment quote: card fees and price are set by the funding provider at checkout.',
    'No deposit, funding order, configuration, DEV or database change was made. Groups stay closed.',
    `Plan hash: \`${plan.planHash}\``);
  return lines.join('\n');
}

// ----- Confirmation-gated execution (topup-closed) -----

/** Stable fields a later execution re-verifies: inventory, targets and planned
 * amounts. Live balances and the observation time drift between plan and
 * execution and are checked separately (balances may only drift down). */
const stableTopupPlan = p => ({
  kind: p.kind, reserveCycles: p.reserveCycles, groups: p.groups,
  items: rows(p.items).map(i => ({ group: i.group, name: i.name, id: i.id, target: i.target, topUp: i.topUp })),
  totalTopUp: p.totals?.totalTopUp,
});

export function assertReviewedTopupPlan(receiptPlan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (!receiptPlan || hashTopupPlan(receiptPlan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved top-up receipt');
  if (JSON.stringify(stableTopupPlan(receiptPlan)) !== JSON.stringify(stableTopupPlan(currentPlan)))
    throw new Error('Live inventory, targets or amounts changed; re-plan');
}

/**
 * Actual deposits from live balances, capped at the reviewed amounts. A
 * canister that already reached its target is skipped; a canister that gained
 * fuel since planning gets less; nothing ever gets more than reviewed. An
 * unreadable live balance stops the run — never deposit blind.
 * `liveBalances`: Map of `${group}/${name}` → decimal cycles string or null.
 */
export function planDeposits({ plan, liveBalances, accountBalance }) {
  const deposits = [];
  for (const item of rows(plan.items)) {
    if (!item.topUp || BigInt(item.topUp) === 0n) continue;
    const key = `${item.group}/${item.name}`;
    const live = decimal(liveBalances?.get(key));
    if (live === undefined) throw new Error(`Live balance unreadable for ${key}; stop without replay`);
    const needed = BigInt(item.target) > BigInt(live) ? BigInt(item.target) - BigInt(live) : 0n;
    const amount = needed < BigInt(item.topUp) ? needed : BigInt(item.topUp);
    if (amount > 0n) deposits.push({ group: item.group, name: item.name, id: item.id, amount: amount.toString(), balanceAtBinding: live });
  }
  const total = deposits.reduce((sum, d) => sum + BigInt(d.amount), 0n);
  const feeBudget = DEPOSIT_FEE_BUDGET * BigInt(deposits.length);
  const account = decimal(accountBalance);
  if (account === undefined) throw new Error('Signing account balance unreadable; stop without replay');
  if (BigInt(account) < total + feeBudget)
    throw new Error('Signing account balance below the reviewed top-up requirement; fund before topping up');
  return { deposits, totalCycles: total.toString(), feeBudget: feeBudget.toString() };
}

/**
 * Checkpointed top-up state machine. Every deposit is preceded by a durable
 * acknowledged intent carrying the ledger dedup timestamp, so a runner loss
 * resumes the same deposit (ledger Duplicate = already landed) instead of
 * paying twice. Deposits are bound into the receipt on first entry so a
 * resume distributes exactly the same amounts.
 */
export async function runCyclesTopup({ plan, receipt, checkpoint, calls, nowNs }) {
  if (receipt.pending) throw new Error('Unresolved intent; reconcile without replay');
  if (receipt.phase === 'fueled') throw new Error('Top-up already completed; this tool never replays a finished run');
  if (!['planned', 'topping', 'verifying'].includes(receipt.phase) ||
      receipt.planHash !== hashTopupPlan(receipt.plan))
    throw new Error('Reviewed top-up plan receipt required');

  let current = { ...receipt, phase: 'topping', completed: receipt.completed ?? [], deposits: receipt.deposits ?? null };
  const save = async next => { current = next; await checkpoint(current); };

  if (!current.deposits) {
    const live = new Map();
    for (const item of rows(plan.items)) {
      if (!item.topUp || BigInt(item.topUp) === 0n) continue;
      live.set(`${item.group}/${item.name}`, (await calls.cyclesOf(item.id)).toString());
    }
    const account = await calls.accountBalance();
    const planned = planDeposits({ plan, liveBalances: live, accountBalance: account.toString() });
    await save({ ...current, deposits: planned.deposits, feeBudget: planned.feeBudget });
  }

  for (const deposit of current.deposits) {
    const key = `${deposit.group}/${deposit.name}`;
    if (current.completed.some(c => `${c.group}/${c.name}` === key)) continue;
    const operation = nowNs().toString();
    await save({ ...current, pending: { kind: 'deposit', service: key, operation } });
    const result = await calls.deposit({ to: deposit.id, amount: BigInt(deposit.amount), createdAtNs: BigInt(operation) });
    await save({ ...current, pending: null,
      completed: [...current.completed, { ...deposit, blockIndex: result.blockIndex ?? null, duplicate: result.duplicate === true }] });
  }
  await save({ ...current, phase: 'verifying' });

  // Verify each deposit landed: balance >= binding-time balance + deposited
  // amount. Balances drift down between planning and execution, so the stale
  // plan target is not the bar; any canister still below target is reported.
  const stillBelow = [];
  for (const deposit of current.completed) {
    const balance = await calls.cyclesOf(deposit.id);
    if (balance < BigInt(deposit.balanceAtBinding) + BigInt(deposit.amount))
      throw new Error(`${deposit.group}/${deposit.name} deposit did not land; stop without replay`);
    const item = rows(plan.items).find(i => i.group === deposit.group && i.name === deposit.name);
    if (item && balance < BigInt(item.target))
      stillBelow.push({ service: `${deposit.group}/${deposit.name}`, balance: balance.toString(), target: item.target });
  }
  await save({ ...current, phase: 'fueled', pending: null });
  return { fueled: true, deposited: current.completed.length,
    totalDeposited: current.completed.reduce((sum, c) => sum + BigInt(c.amount), 0n).toString(),
    skipped: rows(plan.items).filter(i => i.topUp && BigInt(i.topUp) > 0n).length - current.completed.length,
    stillBelowTarget: stillBelow,
    openingAuthorized: false, registrationAuthorized: false };
}

/**
 * Resumes a single unresolved deposit intent through the idempotent ledger
 * adapter: the recorded dedup timestamp is reused, so a deposit that already
 * landed comes back as Duplicate and is recorded, never paid twice.
 */
export async function resumeTopupIntent({ receipt, checkpoint, calls, nowNs }) {
  const pending = receipt.pending;
  if (!pending) return receipt;
  if (pending.kind !== 'deposit') throw new Error('Unknown pending intent; reconcile by hand');
  const deposit = rows(receipt.deposits).find(d => `${d.group}/${d.name}` === pending.service);
  if (!deposit) throw new Error('Deposit intent inconsistent with recorded deposits; reconcile by hand');
  const createdAtNs = BigInt(pending.operation ?? '0');
  if (nowNs() - createdAtNs > DEPOSIT_DEDUP_WINDOW_NS)
    throw new Error('Deposit intent older than the ledger dedup window; reconcile by hand');
  const result = await calls.deposit({ to: deposit.id, amount: BigInt(deposit.amount), createdAtNs });
  const next = { ...receipt, pending: null,
    completed: [...(receipt.completed ?? []), { ...deposit, blockIndex: result.blockIndex ?? null, duplicate: result.duplicate === true }] };
  await checkpoint(next);
  return next;
}

export function topupResultSummary(result) {
  const lines = ['### PROD cycles top-up completed (groups stay CLOSED)', '',
    `Deposits executed: ${result.deposited}. Canisters already at target: ${result.skipped}.`,
    `Total deposited: ${result.totalDeposited} cycles.`];
  if (result.stillBelowTarget?.length) {
    lines.push('', 'Still below the registered minimum (balances drifted during the run; re-plan for the remainder):',
      ...result.stillBelowTarget.map(s => `- ${s.service}: ${s.balance} of ${s.target}`));
  } else {
    lines.push('', 'Every fueled canister was read back at or above its registered minimum.');
  }
  lines.push('', 'Every deposit was verified against the reviewed plan.',
    'No registration, opening, configuration, funding order, DEV or database change was made. Routing approval and admission remain separate reviewed steps.', '');
  return lines.join('\n');
}
