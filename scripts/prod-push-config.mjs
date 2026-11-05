import { assertIsolated, loadIds, REPO_ROOT } from './icp-environments.mjs';
import { pushQueueIds } from './icp-push-batch.mjs';

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
  return { directory, queues };
}

export async function runProdPush(env, parsePrincipal, deliver, root = REPO_ROOT) {
  const config = validateProdPushConfig(env, loadIds('prod', root), loadIds('dev', root), parsePrincipal);
  await deliver({
    ...env, ICP_PUSH_WORKER_SEED: env.PROD_ICP_PUSH_WORKER_SEED,
    FCM_SERVICE_ACCOUNT_JSON: env.PROD_FCM_SERVICE_ACCOUNT_JSON,
    NOTIFICATION_QUEUE_CANISTER_ID: config.directory,
    ICP_PUSH_QUEUE_IDS_JSON: JSON.stringify(config.queues), ICP_HOST: 'https://icp-api.io',
  });
}