// Prints KEY=VALUE build pins for identity_access from the safeguard receipt, for
// promote-icp-prod.yml. No receipt -> nothing (identity was never pinned). A pending
// pin upgrade or unreadable receipt exits non-zero so promotion never drops pins.
import { githubJournal } from './prod-base-group.mjs';
import { SAFEGUARD_RECEIPT } from './prod-safeguard-live-policy.mjs';

try {
  const r = await githubJournal(process.env, fetch, SAFEGUARD_RECEIPT).load({ readOnly: true });
  if (r?.pending?.kind === 'pin') throw Error('pending');
  if (r?.phase === 'identity-pinned') {
    const pins = r.identityPins ?? {};
    if (!pins.IGNITE_PRODUCTION_ACCOUNT_WITNESS || !pins.IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY) throw Error('incomplete');
    for (const [k, v] of Object.entries(pins)) console.log(`${k}=${v}`);
  }
} catch {
  console.error('identity_access safeguard pins unreadable or a pin upgrade is pending; refusing to upgrade identity_access');
  process.exit(1);
}
