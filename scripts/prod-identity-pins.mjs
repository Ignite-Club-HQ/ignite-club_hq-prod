// Prints KEY=VALUE build pins for identity_access from the safeguard receipt, for
// promote-icp-prod.yml. No receipt -> nothing (identity was never pinned). A pending
// pin upgrade or unreadable receipt exits non-zero so promotion never drops pins.
import { githubJournal } from './prod-base-group.mjs';
import { SAFEGUARD_RECEIPT, identityPinEnv } from './prod-safeguard-live-policy.mjs';
import { readFileSync } from 'node:fs';

try {
  const r = await githubJournal(process.env, fetch, SAFEGUARD_RECEIPT).load({ readOnly: true });
  if (r?.pending?.kind === 'pin') throw Error('pending');
  if (r?.phase === 'identity-pinned') {
    // Re-derive from the reviewed receipt so newer pins (witness program and
    // controller) are never dropped by an older saved snapshot.
    const ids = JSON.parse(readFileSync(new URL('../deploy/prod/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
    const pins = identityPinEnv(r, ids);
    for (const [k, v] of Object.entries(r.identityPins ?? {})) if (pins[k] !== v) throw Error('saved pin drift');
    if (!pins.IGNITE_PRODUCTION_ACCOUNT_WITNESS || !pins.IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY) throw Error('incomplete');
    for (const [k, v] of Object.entries(pins)) console.log(`${k}=${v}`);
  }
} catch {
  console.error('identity_access safeguard pins unreadable or a pin upgrade is pending; refusing to upgrade identity_access');
  process.exit(1);
}
