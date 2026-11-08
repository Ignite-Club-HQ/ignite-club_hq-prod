import { assertIsolated, loadIds, REPO_ROOT } from './icp-environments.mjs';
import { pushQueueIds } from './icp-push-batch.mjs';
import { parseRecipientAllowlist } from './icp-push-recipient-policy.mjs';
import { openPushSeed, resolveProdPushPrincipal } from './prod-push-key-policy.mjs';

// Old alerts are settled without sending so a first run never floods phones.
export const PROD_PUSH_MAX_AGE_MS = 30 * 60 * 1000;

/** Validate before importing the delivery worker or making any network call. */
export function validateProdPushConfig(env, prodIds, devIds, parsePrincipal) {
  if (env.GITHUB_REF !== 'refs/heads/prod' || env.IGNITE_ICP_ENV !== 'prod') throw new Error('PROD push requires the prod branch and environment');
  if (env.PROD_ICP_PUSH_ENABLED !== 'true') throw new Error('PROD push is not approved for activation');
  assertIsolated('prod', prodIds, devIds);
  const directory = prodIds.notification_queue;
  if (!directory) throw new Error('PROD notification queue is not provisioned');
  if (!env.PROD_ICP_PUSH_QUEUE_IDS_JSON) throw new Error('Explicit PROD queue inventory required');
  const queues = pushQueueIds(env.PROD_ICP_PUSH_QUEUE_IDS_JSON, undefined, parsePrincipal);
  if (queues.length !== 1 || queues[0] !== parsePrincipal(directory).toText()) throw new Error('PROD queue inventory must match the provisioned base queue exactly');
  if (!/^[0-9a-fA-F]{64}$/.test(env.PROD_ICP_PUSH_WORKER_SEED ?? '')) throw new Error('PROD worker identity is missing or invalid');
  let sa;
  try { sa = JSON.parse(env.PROD_FCM_SERVICE_ACCOUNT_JSON ?? ''); } catch { throw new Error('PROD Firebase credentials are missing or invalid'); }
  if (!env.PROD_FIREBASE_PROJECT_ID || sa.project_id !== env.PROD_FIREBASE_PROJECT_ID || !sa.client_email || !sa.private_key) throw new Error('PROD Firebase credentials do not match the approved Firebase project');
  // Staged rollout: an explicit recipient list is mandatory on PROD.
  if (!env.PROD_ICP_PUSH_RECIPIENTS_JSON) throw new Error('PROD push requires an approved recipient list');
  const recipients = parseRecipientAllowlist(env.PROD_ICP_PUSH_RECIPIENTS_JSON, parsePrincipal);
  return { directory, queues, recipients: [...recipients] };
}

/** Decrypts the stored encrypted PROD worker key in memory; never accepts both forms. */
export function resolveProdWorkerSeed(env, identityType) {
  resolveProdPushPrincipal(env, identityType);
  return env.PROD_ICP_PUSH_WORKER_SEED_ENC
    ? openPushSeed(env.PROD_ICP_PUSH_WORKER_SEED_ENC, env.PROD_ICP_PUSH_WORKER_PASSPHRASE)
    : env.PROD_ICP_PUSH_WORKER_SEED;
}

export async function runProdPush(env, parsePrincipal, deliver, root = REPO_ROOT) {
  const config = validateProdPushConfig(env, loadIds('prod', root), loadIds('dev', root), parsePrincipal);
  await deliver({
    ...env, ICP_PUSH_WORKER_SEED: env.PROD_ICP_PUSH_WORKER_SEED,
    FCM_SERVICE_ACCOUNT_JSON: env.PROD_FCM_SERVICE_ACCOUNT_JSON,
    NOTIFICATION_QUEUE_CANISTER_ID: config.directory,
    ICP_PUSH_QUEUE_IDS_JSON: JSON.stringify(config.queues), ICP_HOST: 'https://icp-api.io',
    ICP_PUSH_RECIPIENTS_JSON: JSON.stringify(config.recipients), ICP_PUSH_MAX_AGE_MS: String(PROD_PUSH_MAX_AGE_MS),
  });
}