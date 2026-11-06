import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { reviewedG2Inventory } from './prod-g2-register-policy.mjs';
import { settingsCommitment, HUMAN_DOMAINS } from './prod-protection-policy.mjs';

export function settingsTargets(ids, page, receipt) {
  if (JSON.stringify(Object.entries(ids).sort()) !== JSON.stringify(Object.entries(PROD_CHECK_IDS).sort())) throw Error('Exact PROD base IDs required');
  const second = reviewedG2Inventory(receipt);
  if (page.next_cursor?.length || page.groups?.length !== 2 || page.placements?.length !== 2 || page.configuration_revision?.length !== 1) throw Error('Complete PROD registry required');
  const rows = [];
  for (const groupId of ['base', 'g2']) {
    const group = page.groups.find(g => g.id === groupId), placement = page.placements.find(p => p.group_id === groupId);
    const expected = groupId === 'base' ? ids : { ...second.domains, media_blob_store: second.photoStore };
    if (!group || !placement || group.target_alias !== 'mainnet' || placement.deployment_id !== 'prod' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' || placement.additional_subnets_enabled !== false || placement.approved_subnets?.length !== 1 || placement.primary_subnet !== placement.approved_subnets[0]) throw Error('PROD placement mismatch');
    for (const name of HUMAN_DOMAINS) {
      const id = name === 'media_blob_store' ? group.photo_store?.[0] : group.domains.find(d => d.domain === name)?.canister;
      if (id !== expected[name]) throw Error('PROD group inventory mismatch');
      if (name !== 'media_blob_store') {
        const placed = placement.domains.find(d => d.domain === name);
        if (placed?.canister !== id || placed?.subnet !== placement.primary_subnet) throw Error('PROD placement service mismatch');
      }
      rows.push({ groupId, name, id });
    }
  }
  if (new Set(rows.map(r => r.id)).size !== 24) throw Error('24 independent PROD receivers required');
  return rows;
}

// Repair only an already-enabled production admission mode. Never commission
// admission/removal, private names, schedulers or another separately held release.
export function matchingProdSettings(rows, identity) {
  settingsCommitment(rows);
  if (identity !== PROD_CHECK_IDS.identity_access) throw Error('Exact PROD identity required');
  const map = new Map(rows.map(r => [r.name, r.value]));
  const admission = map.get('IGNITE_ACCOUNT_ADMISSION_RELEASE') === '1';
  const removal = map.get('IGNITE_ACCOUNT_REMOVAL_RELEASE') === '1';
  if (removal && !admission) throw Error('Removal without admission requires separate review');
  if (map.get('IGNITE_ACCOUNT_SERVICE_IDENTITY') && map.get('IGNITE_ACCOUNT_SERVICE_IDENTITY') !== identity) throw Error('Foreign account authority requires separate review');
  if (!admission && map.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL') === '1') throw Error('Rehearsal-only PROD protection requires separate review');
  if (admission) {
    map.set('IGNITE_ACCOUNT_SERVICE_IDENTITY', identity);
    map.set('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', '0');
  }
  const next = [...map].map(([name, value]) => ({ name, value }));
  return { next, changed: settingsCommitment(next) !== settingsCommitment(rows) };
}

export async function applySettingsPlan(plans, io) {
  // All reads, identity/module checks and exact-code availability precede writes.
  for (const p of plans.filter(p => p.changed)) await io.prepare(p);
  for (const p of plans) {
    if (!p.changed) continue;
    const current = await io.read(p);
    if (settingsCommitment(current.environment) !== settingsCommitment(p.before) || current.moduleHash !== p.moduleHash) throw Error('Settings or module drift; no replay');
    await io.intent(p);
    await io.write(p);
    if (settingsCommitment((await io.read(p)).environment) !== settingsCommitment(p.next)) throw Error('Settings readback mismatch; stop');
    await io.restart(p);
    const after = await io.read(p);
    if (after.moduleHash !== (p.installHash ?? p.moduleHash) || settingsCommitment(after.environment) !== settingsCommitment(p.next)) throw Error('Restart readback mismatch; stop');
    await io.ack(p);
  }
}