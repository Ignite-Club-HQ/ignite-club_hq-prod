import { resolveAuthBackend } from './authBackendMode';
import { getActiveIcpTarget } from './targetRegistry';

// Explicit DEV identities, not the generated table (which is replaced in PROD).
export const DEV_PUSH_QUEUE = 'jfcdq-yiaaa-aaaal-qxloa-cai';
export const DEV_PUSH_IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';

export function isDevIcpPushTarget(target: { host: string; canisterIds: Record<string, string> }): boolean {
  return target.host === 'https://icp-api.io' &&
    target.canisterIds.notification_queue === DEV_PUSH_QUEUE &&
    target.canisterIds.identity_access === DEV_PUSH_IDENTITY;
}

export function usesDevIcpPush(): boolean {
  return resolveAuthBackend() === 'icp' && isDevIcpPushTarget(getActiveIcpTarget());
}