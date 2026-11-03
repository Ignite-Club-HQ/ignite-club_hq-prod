// Pure rules for reloading the 24 PROD member services with their exact
// current code so they pick up settings read only at start/upgrade. Never
// changes code, settings, controllers or groups.
export const RELOAD_CONFIRMATION = 'RELOAD PROD MEMBER SERVICES';
export const RELOAD_RECEIPT_PATH = 'prod-group-setup/member-reload.json';
export const NO_ARG_SERVICES = Object.freeze(['media_blob_store']);

export function reloadTargets(memberReceipt) {
  if (memberReceipt?.phase !== 'settings-applied')
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

export function assertReloadReady({ targets, status, builds, governor, identity }) {
  const problems = [];
  for (const t of targets) {
    const s = status[t.id];
    const b = builds[t.name];
    if (!s) { problems.push(`${t.name} ${t.group}: status unavailable`); continue; }
    if (s.controllers.length !== 1 || s.controllers[0] !== governor) problems.push(`${t.name} ${t.group}: governor must be sole controller`);
    if (!b) problems.push(`${t.name}: no build`);
    else if (!matchingBuild(s.moduleHash, b.hashes)) problems.push(`${t.name} ${t.group}: live code differs from this build`);
    const env = Object.fromEntries(s.environment.map(e => [e.name, e.value]));
    if (env.IGNITE_ACCOUNT_SERVICE_IDENTITY !== identity || env.IGNITE_ACCOUNT_ADMISSION_RELEASE !== '1')
      problems.push(`${t.name} ${t.group}: reviewed settings missing`);
  }
  if (problems.length) throw new Error(`Reload refused: ${problems.join('; ')}`);
}
