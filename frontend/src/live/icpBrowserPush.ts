import { usesDevIcpPush } from './icpPushMode';

export type BrowserPushResult =
  | { status: 'registered' }
  | { status: 'not-configured' | 'unsupported' | 'open-in-new-tab' | 'denied' | 'setup-pending' | 'account-changed' };

export interface BrowserPushConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  vapidKey: string;
}

/** Captured authenticated owner; only a commissioned, installation-fenced adapter may implement this. */
export interface BrowserPushAuthority {
  ready(): Promise<boolean>;
  isCurrent(): boolean;
  register(token: string): Promise<void>;
  unregister(token: string): Promise<void>;
}

export interface BrowserPushRuntime {
  isDev: () => boolean;
  isTopLevel: () => boolean;
  supported: () => Promise<boolean>;
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  token: (config: BrowserPushConfig) => Promise<string>;
}

export function waitForActiveWorker(registration: ServiceWorkerRegistration, timeoutMs = 10_000): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Notification helper did not start in time.')), timeoutMs);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
      else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Notification helper failed to start.')); }
    });
  });
}

const runtime: BrowserPushRuntime = {
  isDev: usesDevIcpPush,
  isTopLevel: () => window.top === window.self,
  supported: async () => {
    if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) return false;
    const { isSupported } = await import('firebase/messaging');
    return isSupported();
  },
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  token: async config => {
    const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([
      import('firebase/app'), import('firebase/messaging'),
    ]);
    const firebaseConfig = { apiKey: config.apiKey, projectId: config.projectId,
      appId: config.appId, messagingSenderId: config.appId.split(':')[1] };
    // A distinct Firebase app/worker never reconfigures the existing email/native Firebase instance.
    const name = `ignite-dev-browser-${config.appId}`;
    const app = getApps().find(candidate => candidate.name === name) ?? initializeApp(firebaseConfig, name);
    const query = new URLSearchParams(firebaseConfig).toString();
    const registration = await navigator.serviceWorker.register(`/icp-dev-firebase-messaging-sw.js?${query}`, {
      scope: '/icp-dev-push/',
    });
    // A first-time registration is still installing; push subscribe needs an active worker.
    await waitForActiveWorker(registration);
    const messaging = getMessaging(app);
    const { onMessage } = await import('firebase/messaging');
    onMessage(messaging, () => { window.dispatchEvent(new Event('ignite:icp-push-received')); });
    return getToken(messaging, { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
  },
};

/** Manual receive-only probe: keep its address in memory, never register with a queue. */
export async function enableDevBrowserPushProbe(
  config: BrowserPushConfig,
  isCurrent: () => boolean,
  browser: BrowserPushRuntime = runtime,
): Promise<BrowserPushResult | { status: 'registered'; token: string }> {
  if (!browser.isDev()) return { status: 'unsupported' };
  if (!config.apiKey || !config.projectId || !/^1:\d+:web:.+$/.test(config.appId) || !config.vapidKey) {
    return { status: 'not-configured' };
  }
  if (!browser.isTopLevel()) return { status: 'open-in-new-tab' };
  if (!isCurrent()) return { status: 'account-changed' };
  if (!await browser.supported()) return { status: 'unsupported' };
  if (!isCurrent() || !browser.isDev()) return { status: 'account-changed' };
  const permission = browser.permission() === 'granted' ? 'granted' : await browser.requestPermission();
  if (permission !== 'granted') return { status: 'denied' };
  if (!isCurrent() || !browser.isDev()) return { status: 'account-changed' };
  const token = await browser.token(config);
  if (!isCurrent() || !browser.isDev()) return { status: 'account-changed' };
  return token ? { status: 'registered', token } : { status: 'denied' };
}

/** Call only from a Settings click. No startup work, Supabase fallback or legacy token adoption. */
export async function enableDevIcpBrowserPush(
  config: BrowserPushConfig,
  authority: BrowserPushAuthority | undefined,
  browser: BrowserPushRuntime = runtime,
): Promise<BrowserPushResult> {
  if (!browser.isDev()) return { status: 'unsupported' };
  if (!config.apiKey || !config.projectId || !/^1:\d+:web:.+$/.test(config.appId) || !config.vapidKey) {
    return { status: 'not-configured' };
  }
  if (!browser.isTopLevel()) return { status: 'open-in-new-tab' };
  // Credentials do not grant queue/device authority. Do not request permission or acquire a
  // device token until the durable owner/worker handover has been confirmed server-side.
  if (!authority || !await authority.ready()) return { status: 'setup-pending' };
  if (!authority.isCurrent()) return { status: 'account-changed' };
  if (!await browser.supported()) return { status: 'unsupported' };
  if (!authority.isCurrent()) return { status: 'account-changed' };
  const permission = browser.permission() === 'granted' ? 'granted' : await browser.requestPermission();
  if (permission !== 'granted') return { status: 'denied' };
  if (!authority.isCurrent() || !browser.isDev()) return { status: 'account-changed' };
  const token = await browser.token(config);
  if (!token) return { status: 'denied' };
  if (!authority.isCurrent() || !browser.isDev()) return { status: 'account-changed' };
  // Never retry an uncertain registration; unregister using the captured original signer.
  try {
    await authority.register(token);
  } catch (error) {
    await authority.unregister(token);
    throw error;
  }
  if (!authority.isCurrent() || !browser.isDev()) {
    await authority.unregister(token);
    return { status: 'account-changed' };
  }
  return { status: 'registered' };
}