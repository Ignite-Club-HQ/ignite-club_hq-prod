export const DEV_ADMIN_IDS = {
  identity_access: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  insights_domain: 'mf5de-eaaaa-aaaal-qxltq-cai',
  messaging_domain: 'mx3u5-iqaaa-aaaal-qxlqq-cai',
};

export function selectExactAdminAccount(rows, principal) {
  const matches = rows.filter(row => row.principals.some(p => p.toText() === principal));
  if (matches.length !== 1 || !('Active' in matches[0].status)) {
    throw Error('Exactly one active account must own this sign-in ID');
  }
  return matches[0];
}

export function assertDevAdminContext(env, ids, governor) {
  if (env.GITHUB_REF !== 'refs/heads/main' || governor !== 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae') throw Error('DEV governor and main branch required');
  for (const [name, id] of Object.entries(DEV_ADMIN_IDS)) {
    if (ids[name] !== id) throw Error('DEV service mapping required');
  }
}