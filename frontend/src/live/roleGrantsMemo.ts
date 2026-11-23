/** Dependency-free memo for caller role grants (safe to import at app start). */
import { clearMembershipDiscovery, invalidateMembershipDisplays } from './membershipDiscoveryCache';
const MEMO_MS = 30_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
const roleChangeListeners = new Set<() => void>();
/** Lets dependents (e.g. standard staff-chat sync) reset when roles change. */
export function onRoleGrantsChanged(listener: () => void): () => void { roleChangeListeners.add(listener); return () => roleChangeListeners.delete(listener); }
function notifyRoleChange() { for (const l of roleChangeListeners) { try { l(); } catch { /* listeners must not break invalidation */ } } }
export function clearRoleGrantsMemo() { memo.clear(); clearMembershipDiscovery(); notifyRoleChange(); }
/** Never invalidate for rejection or unknown outcomes; callers still surface them. */
export async function afterMembershipAcknowledgement<T>(operation: Promise<T>): Promise<T> {
  const receipt = await operation;
  memo.clear();
  invalidateMembershipDisplays();
  notifyRoleChange();
  return receipt;
}
export function memoizedGrants<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as Promise<T>;
  const value = run(); memo.set(key, { at: Date.now(), value });
  value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key); });
  return value;
}
