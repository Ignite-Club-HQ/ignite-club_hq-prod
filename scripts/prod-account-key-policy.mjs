import { createPrivateKey, createPublicKey } from 'node:crypto';
import { sealPushSeed, openPushSeed } from './prod-push-key-policy.mjs';

export const ACCOUNT_KEY_ROLES = Object.freeze({
  account: { environment: 'production-account-approval', prefix: 'PROD_ACCOUNT_APPROVER' },
  recovery: { environment: 'production-recovery-approval', prefix: 'PROD_RECOVERY_APPROVER' },
});
export function accountPublicKey(seed) {
  if (!/^[a-f0-9]{64}$/.test(seed ?? '')) throw Error('Invalid approval seed');
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
}
export function assertAccountKeyContext(env) {
  const role = ACCOUNT_KEY_ROLES[env.KEY_ROLE];
  if (!role || env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
      env.GITHUB_REF !== 'refs/heads/prod' || env.IGNITE_ICP_ENV !== 'prod' || env.KEY_ENVIRONMENT !== role.environment)
    throw Error('Exact independent PROD approval context required');
  if (env.CONFIRMATION !== `CREATE PROD ${env.KEY_ROLE.toUpperCase()} APPROVAL KEY`) throw Error('Exact approval key confirmation required');
  if ((env.PASSPHRASE ?? '').length < 32) throw Error('Dedicated approval passphrase of at least 32 characters required');
  if (!env.PROD_GOVERNOR_PRINCIPAL || !env.INDEPENDENT_REVIEWER_ID || env.INDEPENDENT_REVIEWER_ID === env.GITHUB_ACTOR_ID)
    throw Error('Independent reviewer and existing governor binding required');
  return role;
}
export function assertIndependentProtection(config, reviewerId) {
  const rule = config?.protection_rules?.find(r => r.type === 'required_reviewers');
  if (!rule?.prevent_self_review || config.can_admins_bypass !== false ||
      !rule.reviewers?.some(r => r.type === 'User' && String(r.reviewer?.id) === String(reviewerId)))
    throw Error('Non-bypassable independent environment review required');
}
export function assertIndependentKey(publicKey, principal, env) {
  const forbidden = [env.PROD_GOVERNOR_PRINCIPAL, env.DEV_DEPLOYER_PRINCIPAL, env.PROD_ICP_PUSH_WORKER_PRINCIPAL, env.OTHER_APPROVER_PRINCIPAL, '2vxsx-fae', 'aaaaa-aa'].filter(Boolean);
  if (forbidden.includes(principal) || publicKey === env.OTHER_APPROVER_PUBLIC_KEY) throw Error('Approval identity must be independent');
}
export const sealAccountSeed = (seed, passphrase) => sealPushSeed(seed, passphrase);
export const openAccountSeed = (blob, passphrase) => openPushSeed(blob, passphrase);

export function validateAccountPins(pins, ids) {
  if (pins?.version !== 1 || pins.identity !== ids.identity_access || !pins.witness ||
      Object.values(ids).includes(pins.witness) || ['aaaaa-aa', '2vxsx-fae'].includes(pins.witness) ||
      !/^[a-f0-9]{64}$/.test(pins.accountPublicKey ?? '') || !/^[a-f0-9]{64}$/.test(pins.recoveryPublicKey ?? '') ||
      pins.accountPublicKey === pins.recoveryPublicKey || /^0+$/.test(pins.accountPublicKey) || /^0+$/.test(pins.recoveryPublicKey) ||
      !/^[a-f0-9]{64}$/.test(pins.witnessModuleHash ?? '') || !/^[a-f0-9]{40}$/.test(pins.reviewedSourceCommit ?? ''))
    throw Error('Reviewed independent production pins required');
  return {
    IGNITE_PRODUCTION_ACCOUNT_WITNESS: pins.witness,
    IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY: pins.accountPublicKey,
    IGNITE_RECOVERY_APPROVER_PUBLIC_KEY: pins.recoveryPublicKey,
  };
}