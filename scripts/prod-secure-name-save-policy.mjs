// Pure rules for turning on secure own-name saving on the live (PROD) services.
// Settings are merged over the current list (environment_variables is
// replace-all) and validated by the same rules the TEST release uses.
import { secureNameEnvironment, SAVE_RELEASE } from './secure-name-release-policy.mjs';

export const SECURE_NAME_CONFIRMATION = 'ENABLE SECURE NAME SAVING';
export const SECURE_NAME_RECEIPT_PATH = 'prod-group-setup/secure-name-save.json';

const canon = rows => rows.map(r => ({ name: r.name, value: r.value })).sort((a, b) => a.name.localeCompare(b.name));
export const sameEnvironment = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Plans the exact new settings for both services. The encrypted name store
 * goes first so it is ready before the account service starts requiring it. */
export function planSecureNameSave(ids, live) {
  const identity = ids?.identity_access, pii = ids?.pii_access_control;
  if (!identity || !pii || identity === pii) throw new Error('Exact live account and name-store addresses required');
  const pins = { identity, originalPii: pii };
  return ['pii_access_control', 'identity_access'].map(name => {
    const id = ids[name];
    const current = live[id]?.environment;
    if (!Array.isArray(current)) throw new Error(`${name} settings could not be read; nothing changed`);
    const next = secureNameEnvironment(current, name, 'secure_name_save', pins);
    const done = current.some(r => r.name === SAVE_RELEASE && r.value === '1') && sameEnvironment(current, next);
    return { name, id, current: canon(current), next, done, restart: name === 'pii_access_control' };
  });
}
