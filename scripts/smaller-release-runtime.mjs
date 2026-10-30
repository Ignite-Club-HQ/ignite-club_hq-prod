/** Pure document ownership: storage hints never authorize a backend. */
export const SECURE_PREFIX = '/secure';

export function safeLocalDestination(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
      || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://ignite.invalid');
    if (url.origin !== 'https://ignite.invalid') return null;
    if (/%(?:2f|5c)/i.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export function runtimeForPath(pathname) {
  return pathname === SECURE_PREFIX || pathname.startsWith(SECURE_PREFIX + '/') ? 'icp' : 'supabase';
}

export function authMethodDestination(method, search = '') {
  if (method !== 'icp' && method !== 'supabase') throw new Error('Unknown sign-in method');
  const incoming = new URLSearchParams(search);
  const outgoing = new URLSearchParams();
  const mode = incoming.get('mode');
  if (mode === 'signup' || mode === 'signin') outgoing.set('mode', mode);
  // Invite capabilities are backend-specific. Never forward an unverified
  // email invitation to a canister (or an ICP invitation to Auth).
  const result = `${method === 'icp' ? SECURE_PREFIX : ''}/auth`;
  return outgoing.size ? result + '?' + outgoing : result;
}

export function destinationOwnedByRuntime(value, runtime) {
  const safe = safeLocalDestination(value);
  return safe !== null && runtimeForPath(new URL(safe, 'https://ignite.invalid').pathname) === runtime;
}

export function securePath(value) {
  const safe = safeLocalDestination(value);
  if (!safe) throw new Error('Unsafe secure destination');
  return runtimeForPath(new URL(safe, 'https://ignite.invalid').pathname) === 'icp' ? safe : SECURE_PREFIX + safe;
}

export function secureRequiredInventory(ids, devIds) {
  const required = ['identity_access', 'club_domain', 'events_domain', 'messaging_domain',
    'notification_queue', 'pii_access_control', 'media_metadata', 'media_blob_store', 'competition_domain'];
  const dev = new Set(Object.values(devIds ?? {}));
  if (!ids || required.some(key => typeof ids[key] !== 'string'
      || !/^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai$/.test(ids[key]) || dev.has(ids[key]))) {
    throw new Error('Verified complete isolated secure inventory required');
  }
  if (new Set(required.map(key => ids[key])).size !== required.length) throw new Error('Duplicate secure services');
  return required.map(key => ({ key, id: ids[key] }));
}