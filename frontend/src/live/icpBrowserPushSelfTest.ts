import { usesDevIcpPush } from './icpPushMode';
import type { BrowserPushAuthority } from './icpBrowserPush';

export async function createBrowserSelfTest(userId: string) {
  const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }, { connectLiveNotificationQueue }] = await Promise.all([
    import('./internetIdentityAuth'), import('./targetRegistry'), import('./domains'),
  ]);
  const identity = await getCurrentInternetIdentity();
  const account = userId.replace(/^principal:/, '');
  if (!usesDevIcpPush() || !identity || identity.getPrincipal().toText() !== account) throw new Error('TEST account required');
  const target = getActiveIcpTarget();
  const { actor } = await connectLiveNotificationQueue(target, identity);
  const id = crypto.randomUUID();
  let active = true;
  const current = () => active && usesDevIcpPush() && getActiveIcpTarget().canisterIds.notification_queue === target.canisterIds.notification_queue;
  const unwrap = (result: { Ok?: null; Err?: string }) => { if ('Err' in result) throw new Error('TEST request refused'); };
  const authority: BrowserPushAuthority = {
    ready: async () => {
      // A deployed canister alone is not enough: require the hosted worker as well.
      const response = await fetch('https://ecsdwrarzfexssxtrymj.supabase.co/functions/v1/icp-dev-push-test', { method: 'GET' });
      if (!response.ok || !current()) return false;
      return actor.browser_push_test_ready();
    },
    isCurrent: current,
    register: async token => {
      const freshIdentity = await getCurrentInternetIdentity();
      if (!current() || freshIdentity?.getPrincipal().toText() !== account) throw new Error('Account changed');
      unwrap(await actor.register_browser_push_test(token, id));
    },
    unregister: async () => { unwrap(await actor.revoke_browser_push_test(id)); },
  };
  return {
    authority,
    dispose: async () => { active = false; await actor.revoke_browser_push_test(id); },
    send: async () => {
      if (!current()) throw new Error('Account changed');
      const nowIdentity = await getCurrentInternetIdentity();
      if (!current() || nowIdentity?.getPrincipal().toText() !== account) throw new Error('Account changed');
      unwrap(await actor.request_browser_push_test(id));
      // This separate hosted function sees only an opaque id; ICP supplies owner and token.
      const response = await fetch('https://ecsdwrarzfexssxtrymj.supabase.co/functions/v1/icp-dev-push-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error('TEST send unconfirmed');
      const result = await response.json();
      return typeof result.status === 'string' ? result.status : 'held';
    },
  };
}