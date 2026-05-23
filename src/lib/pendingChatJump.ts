/**
 * Resilient "scroll to this message" handoff for push-notification taps.
 *
 * Background: on Android cold-start, the FCM payload URL like
 * `/messages/{teamId}?message={msgId}` is delivered to the JS layer, but
 * the `?message=` search param is sometimes lost between the
 * `pushNotificationActionPerformed` callback firing, the auth bootstrap
 * navigating around, and the chat page mounting — so the chat opens but
 * never scrolls to the new message.
 *
 * As a safety net, every push handler that knows the message id stores it
 * here, and every chat page reads it on mount as a fallback when the URL
 * search param is missing. Entries expire after 60s so old taps can't
 * hijack a future page mount.
 */

const STORAGE_KEY = "ignite_pending_chat_jump_v1";
const TTL_MS = 60_000;

export type ChatJumpKind = "team" | "club" | "group" | "dm" | "broadcast" | "club_admin";

interface StoredJump {
  kind: ChatJumpKind;
  targetId: string | null; // null for broadcast
  messageId: string;
  ts: number;
}

function read(): StoredJump | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredJump;
    if (!parsed?.messageId || !parsed?.kind) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingChatJump(kind: ChatJumpKind, targetId: string | null, messageId: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const payload: StoredJump = { kind, targetId, messageId, ts: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/**
 * Returns the stored message id (and removes it) when the stored jump
 * matches the given chat. Use on chat-page mount as a fallback when the
 * URL `?message=` search param is missing.
 */
export function consumePendingChatJump(kind: ChatJumpKind, targetId: string | null): string | null {
  const stored = read();
  if (!stored) return null;
  if (stored.kind !== kind) return null;
  if ((stored.targetId ?? null) !== (targetId ?? null)) return null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return stored.messageId;
}

/**
 * Best-effort: derive (kind, targetId, messageId) from a notification
 * payload + URL and persist them so the chat page can pick up the jump
 * even if the search param is stripped during navigation.
 */
export function captureJumpFromNotification(data: any, url: string | null | undefined): void {
  if (!url) return;
  try {
    // Parse search params from the URL even when it's a relative path.
    const parsed = new URL(url, "https://placeholder.local");
    const path = parsed.pathname;
    const msgFromQuery = parsed.searchParams.get("message");
    const msgFromData =
      data?.message_id ||
      data?.messageId ||
      data?.related_id ||
      data?.relatedId ||
      null;
    const messageId = msgFromQuery || msgFromData;
    if (!messageId) return;

    // /messages/dm/{conversationId}
    let m = path.match(/^\/messages\/dm\/([^/]+)/);
    if (m) {
      setPendingChatJump("dm", m[1], messageId);
      return;
    }
    // /messages/club-admin/{conversationId}
    m = path.match(/^\/messages\/club-admin\/([^/]+)/);
    if (m) {
      setPendingChatJump("club_admin", m[1], messageId);
      return;
    }
    // /messages/club/{clubId}
    m = path.match(/^\/messages\/club\/([^/]+)/);
    if (m) {
      setPendingChatJump("club", m[1], messageId);
      return;
    }
    // /messages/broadcast
    if (path === "/messages/broadcast" || path.startsWith("/messages/broadcast/")) {
      setPendingChatJump("broadcast", null, messageId);
      return;
    }
    // /groups/{groupId}
    m = path.match(/^\/groups\/([^/]+)/);
    if (m) {
      setPendingChatJump("group", m[1], messageId);
      return;
    }
    // /messages/{teamId}  (must run AFTER the more-specific /messages/* cases above)
    m = path.match(/^\/messages\/([^/]+)/);
    if (m) {
      setPendingChatJump("team", m[1], messageId);
      return;
    }
  } catch {
    /* ignore */
  }
}
