// Pure, read-only cycles top-up planner for PROD. It computes the exact
// per-canister amount needed to bring every group service to its registered
// minimum (plus an explicit reserve), and nothing else: no deposit, no
// funding order, no configuration change, no DEV access. An unreadable
// balance is reported as unknown and excluded from totals — never treated
// as zero and never turned into an inferred payment need.
import { createHash } from 'node:crypto';
import { assertCheckContext } from './prod-connection-check-policy.mjs';
import { expectedServices } from './prod-routing-gate-policy.mjs';

const decimal = n => /^(0|[1-9][0-9]*)$/.test(String(n)) ? String(n) : undefined;
const rows = list => Array.isArray(list) ? list : [];

export function assertTopupContext(ids, env, principal) {
  assertCheckContext(ids, env, principal);
  if (env.TOPUP_ACTION && env.TOPUP_ACTION !== 'plan') throw new Error('Only read-only plan is supported');
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
