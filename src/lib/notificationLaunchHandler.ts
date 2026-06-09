/**
 * Handler for notification taps that launch the app from cold start.
 *
 * This is the SINGLE source of truth for `pushNotificationActionPerformed`
 * on native. It must be initialized early in the app lifecycle (in main.tsx)
 * to catch taps that fire before React mounts.
 *
 * Architecture (BUG-1 fix — was triple-registered):
 *   - Exactly one Capacitor `pushNotificationActionPerformed` listener,
 *     installed here at module load.
 *   - React side registers a `navigator` via `setNotificationNavigator()` so
 *     warm taps navigate immediately. If no navigator is registered (cold
 *     start), the URL is stashed and consumed by `processPendingNotificationNavigation`.
 *   - Cross-cutting concerns (pitch board open, active-club switch) are
 *     broadcast via the `ignite:notification-tapped` CustomEvent so multiple
 *     consumers can react without re-registering plugin listeners.
 */

import { PushNotifications } from '@capacitor/push-notifications';
import { preloadMessageFromNotification } from './notificationPreload';
import { captureJumpFromNotification, normalizeNotificationChatUrl } from './pendingChatJump';
import { prefetchChatChunkForUrl } from './chatChunkPrefetch';

// Store pending navigation URL until the app is ready to handle it
let pendingNavigationUrl: string | null = null;
let navigationHandled = false;

const PENDING_NAV_KEY = 'pendingPushNavigationUrl';

// Registered navigator from React side (warm-tap path)
type Navigator = (path: string) => void;
let activeNavigator: Navigator | null = null;

export function setNotificationNavigator(nav: Navigator) {
  activeNavigator = nav;
}

export function clearNotificationNavigator(nav: Navigator) {
  if (activeNavigator === nav) activeNavigator = null;
}

function persistPendingNav(url: string) {
  try { sessionStorage.setItem(PENDING_NAV_KEY, url); } catch {}
}

function readPersistedPendingNav(): string | null {
  try { return sessionStorage.getItem(PENDING_NAV_KEY); } catch { return null; }
}

function clearPersistedPendingNav() {
  try { sessionStorage.removeItem(PENDING_NAV_KEY); } catch {}
}

// Global flag for pending force-update prompt (survives timing races)
let pendingForceUpdatePrompt: { storeUrl?: string } | null = null;

export function consumePendingForceUpdatePrompt(): { storeUrl?: string } | null {
  const pending = pendingForceUpdatePrompt;
  pendingForceUpdatePrompt = null;
  return pending;
}

export function getPendingNotificationNavigation(): string | null {
  const url = pendingNavigationUrl || readPersistedPendingNav();
  if (url) {
    pendingNavigationUrl = null;
    clearPersistedPendingNav();
    navigationHandled = true;
  }
  return url;
}

export function clearPendingNotificationNavigation() {
  pendingNavigationUrl = null;
  clearPersistedPendingNav();
  navigationHandled = true;
}

export function peekPendingNotificationNavigation(): string | null {
  return pendingNavigationUrl || readPersistedPendingNav();
}

export function isNotificationNavigationHandled(): boolean {
  return navigationHandled;
}

// BUG-3 fix: include `game_kickoff` so kickoff push opens the pitch board.
const PITCH_BOARD_TYPES = new Set([
  'pending_sub',
  'half_time',
  'game_finished',
  'formation_change',
  'game_kickoff',
]);

function normalizeToPath(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/notifications';
  } catch {
    if (url.startsWith('/')) return url;
    return `/${url.replace(/^\/+/, '')}`;
  }
}

function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appDomains = ['igniteclubhq.app', 'lovable.app', 'lovableproject.com', 'localhost'];
    return !appDomains.some(d => parsed.hostname.endsWith(d));
  } catch {
    return false;
  }
}

/**
 * Single handler for a notification tap — used by the one Capacitor listener
 * installed below. Routes to: store/external browser, immediate navigate (if
 * a navigator is registered), or stashes the URL for the post-mount consumer.
 */
function handleNotificationTap(notification: any) {
  try {
    const data = notification?.notification?.data ?? notification?.data ?? {};
    const rawUrl = data?.url || data?.link || data?.path;
    const url = normalizeNotificationChatUrl(data, rawUrl) || rawUrl;
    console.log('[NotificationLaunch] tap received', {
      notificationId: data?.notificationId ?? data?.id ?? null,
      type: data?.notificationType || data?.type || null,
      message_id: data?.message_id || data?.messageId || null,
      related_id: data?.related_id || null,
      author_id: data?.author_id || data?.sender_id || null,
      rawUrl,
      normalizedUrl: url,
    });
    const storeUrl = data?.store_url;
    const forceUpdatePrompt = data?.force_update_prompt;
    const type = data?.notificationType || data?.type;

    // Force update prompt — open store directly.
    if (forceUpdatePrompt === 'true' || forceUpdatePrompt === true) {
      if (storeUrl) {
        import('@capacitor/browser')
          .then(({ Browser }) => Browser.open({ url: storeUrl }))
          .catch(() => window.open(storeUrl, '_system'));
        navigationHandled = true;
        return;
      }
      pendingForceUpdatePrompt = { storeUrl };
      window.dispatchEvent(new CustomEvent('force-update-prompt', { detail: { storeUrl } }));
      navigationHandled = true;
      return;
    }

    // Store URL (update reminders etc) — external.
    if (storeUrl) {
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url: storeUrl }))
        .catch(() => window.open(storeUrl, '_system'));
      navigationHandled = true;
      return;
    }

    // Best-effort preload + jump capture.
    try { preloadMessageFromNotification(data); } catch {}
    try { captureJumpFromNotification(data, url); } catch {}
    // Warm the chat page chunk in parallel with auth/profile bootstrap so it
    // is already in the module cache by the time the route mounts.
    try { prefetchChatChunkForUrl(url); } catch {}

    if (url && isExternalUrl(url)) {
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url }))
        .catch(() => window.open(url, '_system'));
      navigationHandled = true;
      return;
    }

    const isPitchBoard = !!type && PITCH_BOARD_TYPES.has(type);
    const path = url ? normalizeToPath(url) : (isPitchBoard ? '/' : null);

    // Broadcast for cross-cutting consumers (active club switch, pitch board open).
    try {
      window.dispatchEvent(new CustomEvent('ignite:notification-tapped', {
        detail: { data, path, type, isPitchBoard },
      }));
    } catch {}

    if (!path) return;

    if (activeNavigator) {
      // Warm tap path: navigate immediately, no need to stash.
      clearPendingNotificationNavigation();
      try {
        activeNavigator(path);
      } catch (err) {
        console.warn('[NotificationLaunch] navigator threw, falling back to stash:', err);
        pendingNavigationUrl = path;
        navigationHandled = false;
        persistPendingNav(path);
      }
    } else {
      // Cold start: stash for the post-mount consumer to drain.
      pendingNavigationUrl = path;
      navigationHandled = false;
      persistPendingNav(path);
    }
  } catch (err) {
    console.error('[NotificationLaunch] handleNotificationTap error:', err);
  }
}

/**
 * Initialize notification launch handler.
 * Call this as early as possible in main.tsx.
 */
export function initNotificationLaunchHandler() {
  if (typeof window === 'undefined') return;

  const windowCapacitor = (window as any).Capacitor;
  if (!windowCapacitor || !windowCapacitor.isNativePlatform?.()) {
    console.log('[NotificationLaunch] Not a native platform, skipping');
    return;
  }

  console.log('[NotificationLaunch] Initializing single notification tap listener');

  try {
    PushNotifications.addListener('pushNotificationActionPerformed', handleNotificationTap);
    void checkLaunchNotification(PushNotifications);
  } catch (err) {
    console.warn('[NotificationLaunch] Failed to register PushNotifications listener:', err);
  }
}

async function checkLaunchNotification(PushNotifications: any) {
  try {
    const delivered = await PushNotifications.getDeliveredNotifications();
    console.log('[NotificationLaunch] Delivered notifications:', JSON.stringify(delivered));
  } catch (err) {
    console.warn('[NotificationLaunch] Error checking delivered notifications:', err);
  }
}

/**
 * Process any pending notification navigation.
 * Call this from a React component after the router is ready.
 */
export function processPendingNotificationNavigation(navigate: (path: string) => void): boolean {
  const url = getPendingNotificationNavigation();
  if (url) {
    let path = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const urlObj = new URL(url);
        path = urlObj.pathname + urlObj.search + urlObj.hash;
      } catch {
        path = url;
      }
    }
    navigate(path);
    return true;
  }
  return false;
}
