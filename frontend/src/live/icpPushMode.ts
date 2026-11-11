import { resolveAuthBackend } from './authBackendMode';
import { getActiveIcpTarget } from './targetRegistry';

// Explicit DEV identities, not the generated table (which is replaced in PROD).
export const DEV_PUSH_QUEUE = 'jfcdq-yiaaa-aaaal-qxloa-cai';
export const DEV_PUSH_IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';

// LIVE base queue + identity (the LIVE sender delivers only to its allowlist).
export const LIVE_PUSH_QUEUE = 'w263o-3aaaa-aaaai-ayesq-cai';
export const LIVE_PUSH_IDENTITY = 'wb3hl-byaaa-aaaai-ayeqa-cai';
// LIVE second member group's queue. Phones also register here so that group's
// alerts can find them; the base queue stays the primary registration.
export const LIVE_GROUP_PUSH_QUEUES: readonly string[] = ['zu4gk-vqaaa-aaaal-qxp5a-cai'];
export function groupPushQueues(target: { canisterIds: Record<string, string> }): readonly string[] {
  return target.canisterIds.notification_queue === LIVE_PUSH_QUEUE ? LIVE_GROUP_PUSH_QUEUES : [];
}
const PUSH_PAIRS: ReadonlyArray<readonly [string, string]> = [[DEV_PUSH_QUEUE, DEV_PUSH_IDENTITY], [LIVE_PUSH_QUEUE, LIVE_PUSH_IDENTITY]];

/** Native ICP push runs only on an exact TEST or LIVE queue/identity pair; mixed pairs are refused. */
export function isDevIcpPushTarget(target: { host: string; canisterIds: Record<string, string> }): boolean {
  return target.host === 'https://icp-api.io' && PUSH_PAIRS.some(([queue, identity]) =>
    target.canisterIds.notification_queue === queue && target.canisterIds.identity_access === identity);
}

export function usesDevIcpPush(): boolean {
  return resolveAuthBackend() === 'icp' && isDevIcpPushTarget(getActiveIcpTarget());
}