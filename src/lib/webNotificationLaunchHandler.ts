/**
 * Web equivalent of `notificationLaunchHandler` for native: installed in
 * main.tsx BEFORE React mounts so that BroadcastChannel / postMessage
 * navigation events fired by the service worker are never missed while the
 * page is booting (auth bootstrap, profile load, etc.).
 *
 * Stashes the URL and triggers an optional message-cache preload so the chat
 * page can render the new push message at first paint.
 */
import { preloadMessageFromNotification } from "./notificationPreload";
import { captureJumpFromNotification, normalizeNotificationChatUrl } from "./pendingChatJump";
import { prefetchChatChunkForUrl } from "./chatChunkPrefetch";

let pendingUrl: string | null = null;
const SS_KEY = "ignite_pending_web_push_nav";

function persist(url: string) {
  try { sessionStorage.setItem(SS_KEY, url); } catch {}
}

function readPersisted(): string | null {
  try { return sessionStorage.getItem(SS_KEY); } catch { return null; }
}

function clearPersisted() {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}

export function consumePendingWebPushNav(): string | null {
  const url = pendingUrl || readPersisted();
  if (url) {
    pendingUrl = null;
    clearPersisted();
  }
  return url;
}

function handlePayload(payload: any) {
  if (!payload) return;
  const rawUrl: string | undefined = payload.url;
  const data = payload.data || payload;
  console.log("[WebNotificationLaunch] tap received", {
    notificationId: data?.notificationId ?? data?.id ?? null,
    type: data?.notificationType || data?.type || null,
    message_id: data?.message_id || data?.messageId || null,
    related_id: data?.related_id || null,
    author_id: data?.author_id || data?.sender_id || null,
    rawUrl,
  });
  const url = normalizeNotificationChatUrl(data, rawUrl) || rawUrl;
  if (url) {
    pendingUrl = url;
    persist(url);
    // Persist the exact message target before React navigation starts, so
    // chat pages can still jump correctly if the search param is dropped.
    try { captureJumpFromNotification(data, url); } catch {}
    // Warm the chat page chunk in parallel with auth/profile bootstrap so it
    // is already in the module cache by the time the route mounts.
    try { prefetchChatChunkForUrl(url); } catch {}
  }
  // Best-effort preload — payload may contain the full push data so the chat
  // page can render the new message instantly. Safe no-op if fields missing.
  try {
    preloadMessageFromNotification(data);
  } catch {}
}

let installed = false;

export function initWebNotificationLaunchHandler() {
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;
  // Skip on native — native uses its own launch handler
  if ((window as any).Capacitor?.isNativePlatform?.()) return;

  try {
    const bc = new BroadcastChannel("push-nav");
    bc.onmessage = (event) => {
      handlePayload(event.data);
    };
  } catch {}

  try {
    navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICK_NAVIGATE") {
        handlePayload(event.data);
      }
    });
  } catch {}
}
