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

import { setFromNotificationFlag } from "@/lib/notificationPreload";

const STORAGE_KEY = "ignite_pending_chat_jump_v1";
const TTL_MS = 60_000;

export type ChatJumpKind = "team" | "club" | "group" | "dm" | "broadcast" | "club_admin";

interface StoredJump {
  kind: ChatJumpKind;
  targetId: string | null; // null for broadcast
  messageId: string;
  ts: number;
}

interface ChatJumpTarget {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
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

function pickMessageId(data: any, parsed?: URL): string | null {
  return (
    parsed?.searchParams.get("message") ||
    data?.message_id ||
    data?.messageId ||
    data?.messageID ||
    data?.target_message_id ||
    data?.targetMessageId ||
    // Message notification rows store the message id in related_id. Keep this
    // as a last resort because some older direct-message notifications used
    // related_id for the conversation id instead.
    data?.related_id ||
    data?.relatedId ||
    null
  );
}

function getJumpTarget(data: any, url: string | null | undefined): ChatJumpTarget | null {
  if (!url && !data) return null;
  try {
    const parsed = url ? new URL(url, "https://placeholder.local") : undefined;
    const path = parsed?.pathname ?? "";
    const messageId = pickMessageId(data, parsed);
    if (!messageId) return null;

    const fromPath = (kind: ChatJumpKind, targetId: string | null): ChatJumpTarget => ({ kind, targetId, messageId });
    let m = path.match(/^\/messages\/dm\/([^/]+)/);
    if (m) return fromPath("dm", m[1]);
    m = path.match(/^\/messages\/club-admin\/([^/]+)/);
    if (m) return fromPath("club_admin", m[1]);
    m = path.match(/^\/messages\/club\/([^/]+)/);
    if (m) return fromPath("club", m[1]);
    m = path.match(/^\/messages\/group\/([^/]+)/);
    if (m) return fromPath("group", m[1]);
    if (path === "/messages/broadcast" || path.startsWith("/messages/broadcast/")) return fromPath("broadcast", null);
    m = path.match(/^\/groups\/([^/]+)/);
    if (m) return fromPath("group", m[1]);
    m = path.match(/^\/messages\/([^/]+)/);
    if (m && !["dm", "club", "club-admin", "group", "broadcast"].includes(m[1])) return fromPath("team", m[1]);

    const type = String(data?.notificationType || data?.type || "");
    const contextId = data?.context_id || data?.contextId;
    if (data?.group_id || data?.groupId || type === "group_message") return fromPath("group", data?.group_id || data?.groupId || contextId);
    if (data?.team_id || data?.teamId || type === "team_message") return fromPath("team", data?.team_id || data?.teamId || contextId);
    if (type === "club_admin_message" || data?.is_admin_thread === true || data?.is_admin_thread === "true") return fromPath("club_admin", data?.conversation_id || data?.conversationId || contextId);
    if (type === "direct_message") return fromPath("dm", data?.conversation_id || data?.conversationId || contextId);
    if (data?.club_id || data?.clubId || type === "club_message") return fromPath("club", data?.club_id || data?.clubId || contextId);
    if (type === "broadcast" || data?.broadcast_id || data?.broadcastId) return fromPath("broadcast", null);
  } catch {
    return null;
  }
  return null;
}

export function normalizeNotificationChatUrl(data: any, url: string | null | undefined): string | null {
  if (!url) return null;
  const target = getJumpTarget(data, url);
  if (!target) return url;

  const basePath = (() => {
    switch (target.kind) {
      case "dm": return target.targetId ? `/messages/dm/${target.targetId}` : "/messages";
      case "club_admin": return target.targetId ? `/messages/club-admin/${target.targetId}` : "/messages";
      case "club": return target.targetId ? `/messages/club/${target.targetId}` : "/messages";
      case "group": return target.targetId ? `/groups/${target.targetId}` : "/messages";
      case "broadcast": return "/messages/broadcast";
      case "team": return target.targetId ? `/messages/${target.targetId}` : "/messages";
    }
  })();
  const parsed = new URL(url, "https://placeholder.local");
  const next = new URL(basePath, "https://placeholder.local");
  parsed.searchParams.forEach((value, key) => next.searchParams.set(key, value));
  next.searchParams.set("message", target.messageId);
  next.hash = parsed.hash;
  return `${next.pathname}${next.search}${next.hash}`;
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
  const target = getJumpTarget(data, url);
  if (!target) return;
  setPendingChatJump(target.kind, target.targetId, target.messageId);
  if (target.targetId) setFromNotificationFlag(target.kind, target.targetId);
}
