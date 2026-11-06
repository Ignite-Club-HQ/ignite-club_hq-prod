export const PAUL_PROD_PRINCIPAL = 'uuq6o-np4vy-sv6o7-ongim-26u3l-uje3n-abouz-7fi33-fwbkk-np27z-rae';
export const ADMIN_TARGETS = Object.freeze({ identity: 'wb3hl-byaaa-aaaai-ayeqa-cai', insights: ['wiymx-xqaaa-aaaai-ayerq-cai', 'vylgr-lqaaa-aaaai-ayezq-cai'] });
export function selectPaulAccount(rows, principal) {
  if (principal !== PAUL_PROD_PRINCIPAL) throw Error('Only the owner-approved production login is supported');
  const matches = rows.filter(row => row.principals.some(p => p.toText() === principal));
  if (matches.length !== 1 || !('Active' in matches[0].status)) throw Error('Exactly one active existing account required');
  return matches[0];
}
export function hasGlobalAdmin(row) {
  return row.roles.some(r => r.role === 'app_admin' && r.club.length === 0 && r.team.length === 0 && r.site_id.length === 0);
}
export async function alignAdmin({ principal, action, confirmation, readAccount, readAdmins, grantIdentity, grantInsights }) {
  if (!['check', 'grant'].includes(action)) throw Error('Only check or grant supported');
  if (action === 'grant' && confirmation !== 'GRANT PAUL PROD APP ADMIN') throw Error('Exact owner confirmation required');
  const account = selectPaulAccount(await readAccount(principal), principal);
  const before = await Promise.all(ADMIN_TARGETS.insights.map(readAdmins));
  if (action === 'grant') {
    if (!hasGlobalAdmin(account)) await grantIdentity(account.account_id);
    for (let i = 0; i < before.length; i++) {
      if (!before[i].includes(principal)) await grantInsights(ADMIN_TARGETS.insights[i], principal);
    }
  }
  const final = selectPaulAccount(await readAccount(principal), principal);
  if (final.account_id !== account.account_id) throw Error('Account association changed; stop');
  const admins = await Promise.all(ADMIN_TARGETS.insights.map(readAdmins));
  const result = { accountId: final.account_id, identityAdmin: hasGlobalAdmin(final), insightsAdmins: admins.map(list => list.includes(principal)), action };
  if (action === 'grant' && (!result.identityAdmin || result.insightsAdmins.some(x => !x))) throw Error('Admin grant readback incomplete; inspect before retry');
  return result;
}