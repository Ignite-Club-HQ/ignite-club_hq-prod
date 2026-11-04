// Pure rules for reloading the 24 PROD member services with their exact
// current code so they pick up settings read only at start/upgrade. Never
// changes code, settings, controllers or groups.
export const RELOAD_CONFIRMATION = 'RELOAD PROD MEMBER SERVICES';
export const RELOAD_RECEIPT_PATH = 'prod-group-setup/member-reload.json';
export const NO_ARG_SERVICES = Object.freeze(['media_blob_store']);

export function reloadTargets(memberReceipt) {
  if (!['settings-applied', 'commissioned'].includes(memberReceipt?.phase))
    throw new Error('Member-access settings must be applied before reload');
  const targets = memberReceipt.plan?.targets ?? [];
  if (targets.length !== 24 || new Set(targets.map(t => t.id)).size !== 24)
    throw new Error('Exactly twenty-four distinct member services required');
  return targets.map(({ name, id, group }) => ({ name, id, group }));
}

/** Live module must equal the freshly built artifact (raw or gzip bytes). */
export function matchingBuild(liveHash, builtHashes) {
  return Boolean(liveHash) && builtHashes.includes(liveHash);
}

export const UPGRADE_GROUPS = Object.freeze(['g2']);
export const MIN_UPGRADE_CYCLES = 20_000_000_000n;

/** A later group may move to this build only when every first-group service of
 * the same name already runs it, so it receives code already proven live. */
export function assertReloadReady({ targets, status, builds, governor, identity, upgradeGroup = null }) {
  const problems = [];
  if (upgradeGroup !== null && !UPGRADE_GROUPS.includes(upgradeGroup)) problems.push(`group ${upgradeGroup} cannot be updated here`);
  const provenNames = new Set(targets.filter(t => t.group !== upgradeGroup && status[t.id] && builds[t.name]
    && matchingBuild(status[t.id].moduleHash, builds[t.name].hashes)).map(t => t.name));
  for (const t of targets) {
    const s = status[t.id];
    const b = builds[t.name];
    if (!s) { problems.push(`${t.name} ${t.group}: status unavailable`); continue; }
    if (s.controllers.length !== 1 || s.controllers[0] !== governor) problems.push(`${t.name} ${t.group}: governor must be sole controller`);
    if (!b) problems.push(`${t.name}: no build`);
    else if (!matchingBuild(s.moduleHash, b.hashes)) {
      if (t.group !== upgradeGroup) problems.push(`${t.name} ${t.group}: live code differs from this build`);
      else if (!provenNames.has(t.name)) problems.push(`${t.name} ${t.group}: first group does not run this build yet`);
      else if (typeof s.cycles === 'bigint' && s.cycles < MIN_UPGRADE_CYCLES) problems.push(`${t.name} ${t.group}: needs more fuel before update`);
    }
    const env = Object.fromEntries(s.environment.map(e => [e.name, e.value]));
    if (env.IGNITE_ACCOUNT_SERVICE_IDENTITY !== identity || env.IGNITE_ACCOUNT_ADMISSION_RELEASE !== '1')
      problems.push(`${t.name} ${t.group}: reviewed settings missing`);
  }
  if (problems.length) throw new Error(`Reload refused: ${problems.join('; ')}`);
  return targets.filter(t => !matchingBuild(status[t.id].moduleHash, builds[t.name].hashes)).map(t => t.id);
}
