// Optional delivery limits for a staged rollout. When unset (TEST), every
// claimed notification is attempted exactly as before.

/** Returns a Set of allowed recipient principals, or null when unrestricted. */
export function parseRecipientAllowlist(raw, parsePrincipal) {
  if (raw === undefined || raw === '') return null;
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 16) throw new Error('Invalid push recipient list');
  return new Set(ids.map(id => {
    if (typeof id !== 'string') throw new Error('Invalid push recipient');
    return parsePrincipal(id).toText();
  }));
}

export function parseMaxAgeMs(raw) {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 60_000) throw new Error('Invalid push max age');
  return value;
}

/**
 * Decide whether a claimed notification is sent. Skipped items are settled the
 * same way as "no device registered": nothing is sent, the bell entry is untouched.
 */
export function deliveryDecision(n, nowMs, allowlist, maxAgeMs) {
  if (allowlist && !allowlist.has(n.user)) return 'skip_recipient';
  if (maxAgeMs !== null && maxAgeMs !== undefined && Number(nowMs) - Number(n.created_at_ms) > maxAgeMs) return 'skip_stale';
  return 'send';
}
