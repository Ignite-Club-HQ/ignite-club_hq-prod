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
    identity_access: { method: 'set_identity_access_canister', target: 'identity_access' },
    media_store: { method: 'set_gallery_media_authority', target: 'media_blob_store' },
    competition_authority: { method: 'set_competition_domain_canister', target: 'competition_domain' },
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
      if (b.setting === ADMISSION_FLAG || b.setting === ADMISSION_AUTHORITY) {
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
