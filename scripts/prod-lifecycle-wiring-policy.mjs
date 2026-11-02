// Pure, read-only planner for PROD lifecycle wiring. It turns the routing
// gate's own per-service readback into an ordered list of the exact calls a
// later, separately approved closed runner would make. It calls nothing,
// records nothing and never opens a group.
import { createHash } from 'node:crypto';
import { ADMISSION_FLAG, ADMISSION_AUTHORITY } from './prod-routing-gate-policy.mjs';

/** Additive service links and worker grants: safe while groups stay closed,
 * because they only name each group's own services and the PROD identities. */
const LINK_CALLS = Object.freeze({
  club_domain: {
    // The `media_store` row is the media quota store registry. Gallery
    // authority is media_metadata and must never be pointed at the blob store.
    media_store: { method: 'register_media_quota_store', target: 'media_blob_store' },
  },
  notification_queue: { worker: { method: 'grant_worker', target: 'push_worker' } },
  timer_jobs: { 'worker:*': { method: 'grant_worker', target: 'push_worker' } },
});

/** Removal enforcement is held: scripts/AGENTS.md forbids setting the
 * admission switch or overwriting the account-service reader inventory from
 * deploy tooling, and base cannot use the per-group (g2+) admission path. */
export const ADMISSION_HOLD = 'Held: releasing removal checks needs a production admission path for every group (base cannot use the g2+ path) and the switch may not be set by setup tooling. Separate backend work and owner approval required.';

export function planLifecycleWiring(review, { ids, pushWorker } = {}) {
  if (!review || !Array.isArray(review.diagnostics)) throw new Error('Routing gate review required');
  const byService = new Map(review.diagnostics.map(d => [`${d.group}/${d.service}`, d]));
  const ready = [], held = [], unknown = [];
  for (const d of review.diagnostics) {
    for (const b of d.bindings) {
      if (b.result === 'matched') continue;
      // club_domain's identity link refuses until the removal switch is on,
      // and an unset link reads back as "different"; both belong to the hold.
      if (b.setting === ADMISSION_FLAG || b.setting === ADMISSION_AUTHORITY ||
        (d.service === 'club_domain' && b.setting === 'identity_access')) {
        held.push({ group: d.group, service: d.service, canisterId: d.canisterId, setting: b.setting, reason: ADMISSION_HOLD });
        continue;
      }
      const call = LINK_CALLS[d.service]?.[b.setting];
      const targetId = !call ? undefined : call.target === 'push_worker' ? pushWorker
        : call.target === 'identity_access' ? ids?.identity_access
        : byService.get(`${d.group}/${call.target}`)?.canisterId;
      // A "different" value or an unknown target is never overwritten here.
      if (!call || !targetId || targetId !== b.expected || b.result === 'different') {
        unknown.push({ group: d.group, service: d.service, setting: b.setting, result: b.result });
        continue;
      }
      ready.push({ group: d.group, service: d.service, canisterId: d.canisterId,
        method: call.method, argument: targetId, setting: b.setting });
    }
  }
  const order = { club_domain: 0, notification_queue: 1, timer_jobs: 2 };
  ready.sort((a, b) => a.group.localeCompare(b.group) || order[a.service] - order[b.service] || a.setting.localeCompare(b.setting));
  const planSha256 = createHash('sha256').update(JSON.stringify(ready)).digest('hex');
  return { ready, held, unknown, planSha256, executes: false, opensGroups: false };
}

export function lifecycleWiringSummary(plan) {
  return ['### Lifecycle wiring plan (read-only, nothing applied)', '',
    `Ready now, groups stay closed: ${plan.ready.length} call(s) · plan \`${plan.planSha256}\``, '',
    '| Group/service | Canister | Call | Value |', '|---|---|---|---|',
    ...plan.ready.map(o => `| ${o.group}/${o.service} | ${o.canisterId} | ${o.method} | ${o.argument} |`), '',
    `Held removal-check items: ${plan.held.length}. ${ADMISSION_HOLD}`, '',
    ...(plan.unknown.length ? ['Not planned (value differs or target unknown; never overwritten):',
      ...plan.unknown.map(u => `- ${u.group}/${u.service}: ${u.setting} is ${u.result}`)] : []),
    'This plan executes nothing.'].join('\n') + '\n';
}

export const WIRING_CONFIRMATION = 'WIRE PROD LIFECYCLE';

/** Every planned call is idempotent on the canister (an existing store or
 * worker returns Ok unchanged), so a rerun after interruption cannot double-apply. */
export const WIRING_METHODS = Object.freeze(['register_media_quota_store', 'grant_worker']);

export function assertWiringApproval(plan, { reviewedHash, confirmation, groups }) {
  if (confirmation !== WIRING_CONFIRMATION) throw new Error(`Exact confirmation required: ${WIRING_CONFIRMATION}`);
  if (!/^[0-9a-f]{64}$/.test(reviewedHash ?? '')) throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (!plan.ready.length) throw new Error('Nothing left to wire; rerun the read-only gate');
  if (plan.planSha256 !== reviewedHash) throw new Error('Live wiring plan changed since review; re-run the read-only gate');
  if (plan.ready.some(o => !WIRING_METHODS.includes(o.method))) throw new Error('Plan contains a call outside the closed wiring allowlist');
  if (!Array.isArray(groups) || !groups.length || groups.some(g => g.accepting !== false))
    throw new Error('Every group must stay CLOSED before wiring');
  return true;
}
