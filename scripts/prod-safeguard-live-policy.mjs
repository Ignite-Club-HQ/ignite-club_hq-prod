// Pure checks for the live closed safeguard setup (scripts/prod-safeguard-live.mjs).
// Order: create witness (governor pays, recovery key is sole controller) ->
// install witness (recovery key) -> pin identity_access (governor, upgrade only).
// Nothing here enables protections, signs approvals or opens a group.
import { validateAccountPins } from './prod-account-key-policy.mjs';

export const SAFEGUARD_CONFIRMATION = 'SET UP PROD SAFEGUARD CLOSED';
export const SAFEGUARD_RECEIPT = Object.freeze({ branch: 'prod-group-setup', path: 'prod-group-setup/safeguard.json', label: 'safeguard' });
export const KEY_RECEIPT = role => ({ branch: 'prod-group-setup', path: `prod-group-setup/${role}-approval-key.json`, label: `${role} key` });
export const WITNESS_CYCLES = 1_500_000_000_000n;
export const PHASES = Object.freeze(['planned', 'witness-created', 'witness-installed', 'identity-pinned']);
const STEP_FROM = Object.freeze({ create: 'planned', install: 'witness-created', pin: 'witness-installed' });
const PENDING = Object.freeze({ create: 'create', install: 'install', pin: 'pin' });
const hex64 = v => /^[a-f0-9]{64}$/.test(v ?? '') && !/^0+$/.test(v);

export function assertSafeguardContext(env) {
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' || env.GITHUB_REF !== 'refs/heads/prod' ||
      env.IGNITE_ICP_ENV !== 'prod' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''))
    throw Error('Exact live prod branch context required');
  if (env.CONFIRMATION !== SAFEGUARD_CONFIRMATION) throw Error(`Exact confirmation required: ${SAFEGUARD_CONFIRMATION}`);
  if (!['create', 'install', 'pin'].includes(env.SAFEGUARD_JOB)) throw Error('Unknown safeguard step');
}

/** Public pins come from the completed key receipts; never from form inputs. */
export function publicPins(account, recovery, env) {
  for (const [role, r] of [['account', account], ['recovery', recovery]])
    if (r?.version !== 1 || r.role !== role || r.phase !== 'encrypted-ready' || !hex64(r.publicKey) || !r.principal)
      throw Error('Completed account and recovery key receipts required');
  const forbidden = [env.PROD_GOVERNOR_PRINCIPAL, env.DEV_DEPLOYER_PRINCIPAL, env.PROD_ICP_PUSH_WORKER_PRINCIPAL, '2vxsx-fae', 'aaaaa-aa'].filter(Boolean);
  if (account.publicKey === recovery.publicKey || account.principal === recovery.principal ||
      forbidden.includes(account.principal) || forbidden.includes(recovery.principal) || !env.PROD_GOVERNOR_PRINCIPAL)
    throw Error('Independent account and recovery keys required');
  return { accountPublicKey: account.publicKey, accountPrincipal: account.principal,
    recoveryPublicKey: recovery.publicKey, recoveryPrincipal: recovery.principal };
}

export function assertGroupsClosed(page) {
  const groups = page?.groups ?? [];
  if (page?.next_cursor?.length || groups.length !== 2 || groups.map(g => g.id).sort().join(',') !== 'base,g2' ||
      groups.some(g => g.accepting !== false))
    throw Error('Both groups must be registered and closed');
}

/** 'run' | 'done' — refuses steps out of order and pending intents of another step. */
export function stepState(receipt, job) {
  const from = STEP_FROM[job];
  const at = receipt ? PHASES.indexOf(receipt.phase) : 0;
  if (at < 0) throw Error('Unknown safeguard receipt phase');
  if (receipt?.pending && receipt.pending.kind !== PENDING[job]) throw Error('Unresolved intent from another step; reconcile read-only first');
  if (at > PHASES.indexOf(from)) return 'done';
  if (at < PHASES.indexOf(from)) throw Error('Earlier safeguard step not complete');
  return 'run';
}

export function assertSamePlan(receipt, plan) {
  for (const key of ['identity', 'subnet', 'witnessModuleHash', 'governor'])
    if (receipt[key] !== plan[key]) throw Error('Safeguard plan changed since the recorded intent; stop without replay');
  if (JSON.stringify(receipt.pins) !== JSON.stringify(plan.pins)) throw Error('Safeguard plan changed since the recorded intent; stop without replay');
}

export function assertWitnessState(state, receipt, { installed }) {
  if (JSON.stringify(state.controllers) !== JSON.stringify([receipt.pins.recoveryPrincipal]))
    throw Error('Safeguard must be controlled only by the recovery key');
  if (state.subnet !== undefined && state.subnet !== receipt.subnet) throw Error('Safeguard landed on an unexpected subnet');
  if (installed ? state.moduleHash !== receipt.witnessModuleHash : state.moduleHash !== null)
    throw Error(installed ? 'Safeguard program differs from the reviewed build' : 'New safeguard unexpectedly holds a program');
}

/** Build-time env for identity_access; validated by the shared production pin rules. */
export function identityPinEnv(receipt, ids) {
  if (!receipt.witness || !hex64(receipt.witnessModuleHash)) throw Error('Installed safeguard required before pinning');
  return validateAccountPins({ version: 1, identity: ids.identity_access, witness: receipt.witness,
    accountPublicKey: receipt.pins.accountPublicKey, recoveryPublicKey: receipt.pins.recoveryPublicKey,
    witnessModuleHash: receipt.witnessModuleHash, reviewedSourceCommit: receipt.sourceCommit }, ids);
}
