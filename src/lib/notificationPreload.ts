/**
 * Pre-hydrate the message cache from an incoming push notification payload so
 * that when the user taps the notification and the chat page mounts, the new
 * message is already visible at first paint instead of appearing 2–5 seconds
 * later when the network fetch / realtime subscription finally lands.
 *
 * This is intentionally tolerant: if any required field is missing, we simply
 * no-op and the page falls back to today's behaviour (stale cache + refetch).
 *
 * Companion helper `consumeFromNotificationFlag` lets a chat page detect that
 * it was opened from a notification within the last 60s, so it can skip the
 * stale `placeholderData` render and force a priority refetch.
 */
import { addMessageToCache, type CachedMessage } from "@/lib/messageCache";

type ChatKind = "dm" | "team" | "club" | "group" | "broadcast" | "club_admin";

const FLAG_PREFIX = "ignite_from_notification_";
const FLAG_TTL_MS = 60_000;

interface ParsedPreload {
  kind: ChatKind;
  targetId: string;
  message: CachedMessage;
}

function parsePayload(data: any): ParsedPreload | null {
  if (!data || typeof data !== "object") return null;

  const messageId: string | undefined = data.message_id || data.messageId;
  const text: string | undefined = typeof data.text === "string" ? data.text : data.body;
  const authorId: string | undefined = data.author_id || data.authorId || data.sender_id;
  const createdAt: string | undefined = data.created_at || data.createdAt;
  if (!messageId || !authorId || !createdAt) return null;

  // Determine target conversation/chat. Order matters — DM first because some
  // payloads include both conversation_id and team_id (e.g. cross-posts).
  let kind: ChatKind | null = null;
  let targetId: string | undefined;
  if (data.conversation_id || data.conversationId) {
    kind = "dm";
    targetId = data.conversation_id || data.conversationId;
  } else if (data.group_id || data.groupId) {
    kind = "group";
    targetId = data.group_id || data.groupId;
  } else if (data.team_id || data.teamId) {
    kind = "team";
    targetId = data.team_id || data.teamId;
  } else if (data.club_id || data.clubId) {
    kind = data.is_admin_thread ? "club_admin" : "club";
    targetId = data.club_id || data.clubId;
  } else if (data.broadcast_id || data.broadcastId) {
    kind = "broadcast";
    targetId = data.broadcast_id || data.broadcastId;
  }
  if (!kind || !targetId) return null;

  const message: CachedMessage = {
    id: messageId,
    text: text || "",
    author_id: authorId,
    created_at: createdAt,
    image_url: data.image_url || null,
    reply_to_id: data.reply_to_id || null,
    profiles: data.author_display_name
      ? {
          display_name: data.author_display_name,
          avatar_url: data.author_avatar_url || null,
        }
      : null,
    reactions: [],
    reply_to: null,
  };

  return { kind, targetId, message };
}

/**
 * Best-effort: write the inbound message into the local cache so the chat page
 * shows it instantly, and set a flag so the page knows it was opened from a
 * notification (and should bypass stale placeholders).
 */
export function preloadMessageFromNotification(data: any): void {
  try {
    const parsed = parsePayload(data);
    if (!parsed) return;
    addMessageToCache(parsed.kind, parsed.targetId, parsed.message);
    setFromNotificationFlag(parsed.kind, parsed.targetId);
  } catch (err) {
    console.warn("[notificationPreload] Failed to preload message", err);
  }
}

function flagKey(kind: ChatKind, targetId: string): string {
  return `${FLAG_PREFIX}${kind}_${targetId}`;
}

export function setFromNotificationFlag(kind: ChatKind, targetId: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(flagKey(kind, targetId), String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * Returns true if this chat was opened from a notification in the last 60s.
 * The flag is consumed (cleared) on read so it only applies to the very next
 * mount of the corresponding chat page.
 */
export function consumeFromNotificationFlag(kind: ChatKind, targetId: string): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    const key = flagKey(kind, targetId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;
    sessionStorage.removeItem(key);
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts <= FLAG_TTL_MS;
  } catch {
    return false;
  }
}
