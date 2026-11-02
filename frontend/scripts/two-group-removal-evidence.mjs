import assert from 'node:assert/strict';

// The queue traps before lease checks for ungranted callers; a Candid Err or
// unrelated transport rejection must never satisfy this capability check.
export async function assertWorkerCapabilityDenied(call) {
  await assert.rejects(call, /Worker capability required/);
}

export const HUMAN_DOMAINS = Object.freeze(['club_domain', 'events_domain', 'messaging_domain', 'vault_domain',
  'competition_domain', 'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain',
  'notification_queue', 'pii_access_control', 'media_blob_store']);

export function validateTwoGroupInventory(groups, targets, sharedWorkload, router) {
  if (groups.length !== 2 || new Set(groups.map(g => g.id)).size !== 2 ||
    !groups.some(g => g.id === 'base') || !groups.some(g => g.id === 'g2')) throw new Error('Exact base/g2 required');
  const expected = new Set([sharedWorkload, router]);
  for (const group of groups) {
    if (group.receivers.length !== 12 || new Set(group.receivers.map(s => s.domain)).size !== 12 ||
      HUMAN_DOMAINS.some(d => !group.receivers.some(s => s.domain === d))) throw new Error('Twelve actual receivers per group required');
    for (const id of [...group.receivers.map(s => s.id), group.timer]) {
      if (!id || expected.has(id)) throw new Error('Independent service identities required');
      expected.add(id);
    }
  }
  if (targets.length !== expected.size || new Set(targets).size !== targets.length ||
    targets.some(id => !expected.has(id))) throw new Error('Frozen targets differ from installed complete inventory');
  return expected.size;
}

export function validateHumanSeals(groups, request, seals) {
  const expected = new Set(groups.flatMap(g => g.receivers.map(s => s.id)));
  const observed = new Set();
  if (expected.size !== 24 || seals.length !== 24) throw new Error('All 24 human receiver seals required');
  for (const seal of seals) {
    const r = seal.request;
    if (!expected.has(seal.receiver) || observed.has(seal.receiver) || seal.outstanding !== 0n ||
      r.account_id !== request.account_id || r.generation !== request.generation ||
      JSON.stringify(r.subjects) !== JSON.stringify(request.subjects) ||
      JSON.stringify(r.inventory_digest) !== JSON.stringify(request.inventory_digest)) throw new Error('Seal binding or drain mismatch');
    observed.add(seal.receiver);
  }
  return true;
}