export interface IcpPushOwner {
  account: string;
  target: string;
  register: (token: string, platform: 'android' | 'ios') => Promise<void>;
  unregister: (token: string) => Promise<void>;
}

/** Single device lifecycle. No backend fallback, persistent token cache or Firebase deletion. */
export function createIcpPushLifecycle() {
  let desired: IcpPushOwner | undefined;
  let generation = 0;
  let registered: { owner: IcpPushOwner; token: string; platform: 'android' | 'ios' } | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let cleanupBlocked = false;
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work, work);
    chain = result.catch(() => undefined);
    return result;
  };

  async function retire() {
    if (!registered) return;
    cleanupBlocked = true;
    await registered.owner.unregister(registered.token);
    registered = undefined;
    cleanupBlocked = false;
  }

  return {
    bind(owner: IcpPushOwner) {
      desired = owner;
      generation += 1;
      return generation;
    },
    isCurrent(ticket: number) { return ticket === generation && desired !== undefined; },
    register(ticket: number, token: string, platform: 'android' | 'ios') {
      return serialize(async () => {
        const owner = desired;
        if (!owner || ticket !== generation) return false;
        if (!token || token.length > 4096) throw new Error('Invalid push registration');
        if (registered && (cleanupBlocked || registered.owner.account !== owner.account ||
          registered.owner.target !== owner.target || registered.token !== token)) await retire();
        if (ticket !== generation) return false;
        // Identical tokens are refreshed on resume, but never registered twice concurrently.
        if (registered?.owner === owner && registered.token === token) return true;
        // Retain the intent before awaiting: a lost reply must still be removable
        // as the original signer, never silently attributed to another account.
        registered = { owner, token, platform };
        await owner.register(token, platform);
        if (ticket !== generation) { await retire(); return false; }
        return true;
      });
    },
    refresh(ticket: number) {
      return serialize(async () => {
        if (!desired || ticket !== generation || !registered || cleanupBlocked) return;
        if (registered.owner.account !== desired.account || registered.owner.target !== desired.target) return;
        await desired.register(registered.token, registered.platform);
      });
    },
    revoke() {
      desired = undefined;
      generation += 1;
      return serialize(retire);
    },
  };
}