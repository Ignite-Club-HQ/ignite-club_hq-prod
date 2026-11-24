// Device-level marker (deliberately NOT `ignite_`-prefixed, so sign-out cache
// sweeps keep it): set when this phone's alert address was registered on the
// secure servers. Email mode then rotates the address before saving it, so an
// unremoved secure registration (e.g. offline sign-out) goes dead.
const KEY = 'device_push_secure_registered';

export function markSecurePushRegistered(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
}
export function securePushRegistrationPending(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function clearSecurePushRegistered(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/** Returns the token email mode should save: a fresh one if the phone was on secure servers. */
export async function handOverPushToken(
  token: string,
  messaging: { deleteToken(): Promise<unknown>; getToken(): Promise<{ token?: string }> } | null,
): Promise<string> {
  if (!securePushRegistrationPending() || !messaging) return token;
  try {
    await messaging.deleteToken();
    const fresh = (await messaging.getToken())?.token;
    if (!fresh) return token;
    clearSecurePushRegistered();
    return fresh;
  } catch {
    return token; // never block email-mode alerts
  }
}
