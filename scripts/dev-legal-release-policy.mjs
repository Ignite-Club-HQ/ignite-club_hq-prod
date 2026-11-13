// Exact, owner-approved DEV initial-signup legal release (issue #1503).
// This is not the forced-reacceptance setting and never applies to PROD.
export const DEV_LEGAL = Object.freeze({
  repo: 'Ignite-Club-HQ/ignite-club_hq-prod',
  ref: 'refs/heads/main',
  env: 'dev',
  governor: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
  group1: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  group2: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  key: 'legal_document_release',
  release: '2026-11-13',
  confirmation: 'PUBLISH DEV G2 LEGAL 2026-11-13',
});

export function checkDevLegalContext(env) {
  if (env.GITHUB_REPOSITORY !== DEV_LEGAL.repo ||
      env.GITHUB_REF !== DEV_LEGAL.ref ||
      env.IGNITE_ICP_ENV !== DEV_LEGAL.env)
    throw Error('Require the reviewed repository, main branch and DEV environment');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''))
    throw Error('Exact GitHub release commit required');
  const action = env.ACTION;
  if (action !== 'check' && action !== 'publish')
    throw Error('Choose check or publish');
  if (action === 'publish' && env.CONFIRMATION !== DEV_LEGAL.confirmation)
    throw Error('Exact DEV G2 legal-release confirmation required');
  if (action === 'check' && (env.CONFIRMATION || '').trim())
    throw Error('Read-only check takes no publication confirmation');
  return action;
}

export function checkDevLegalInventory(g1, g2, prodIds = {}) {
  if (g1 !== DEV_LEGAL.group1 || g2 !== DEV_LEGAL.group2 || g1 === g2)
    throw Error('Pinned DEV group identities do not match repository inventory');
  if (Object.values(prodIds).includes(g1) || Object.values(prodIds).includes(g2))
    throw Error('Refusing an ID present in the PROD canister inventory');
}

export function planDevLegalRelease(group1Value, group2Value) {
  if (group1Value !== DEV_LEGAL.release)
    throw Error('Group 1 must independently publish the owner-approved plain-text date');
  if (group2Value !== null && group2Value !== DEV_LEGAL.release)
    throw Error('Group 2 contains a different or malformed release; manual review required');
  return group2Value === null ? 'write-group2-once' : 'already-matching';
}

export function assertDevLegalGovernor(principal) {
  if (principal !== DEV_LEGAL.governor)
    throw Error('Original pinned DEV governor required');
}
