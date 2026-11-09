/**
 * Decides whether the person reading a chat is actually allowed to see its
 * messages, so the app can say so instead of showing an empty thread.
 *
 * Why this exists: both backends answer "you may not read this chat" in a way
 * that looks identical to "nobody has posted yet".
 * - Supabase row-level security hides every `group_messages` row silently
 *   (zero rows, no error) because the chat's read policy is
 *   `can_access_chat_group(auth.uid(), group_id)`.
 * - The messaging canister refuses the read with
 *   "… failed: Conversation access forbidden".
 *
 * The rules below are deliberately one-sided: only an explicit refusal from
 * the server's own authority may deny access. Anything unknown (a failed
 * permission read, a dropped connection, a chat whose details haven't
 * arrived) keeps the existing behaviour rather than falsely telling a member
 * they can't see their own chat.
 */

export type GroupChatAccess = "granted" | "denied" | "unknown";

/**
 * The canister's refusal texts, all raised by the same membership check:
 * "Conversation access forbidden", "Club chat access forbidden", and the
 * forward/read variants. A missing conversation ("Conversation not found")
 * is a different outcome and must not match here.
 */
const ACCESS_DENIED_TEXT = /(?:conversation|chat) access forbidden/i;

/** True when an error is the server refusing to open this chat's messages. */
export function isChatAccessDeniedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return ACCESS_DENIED_TEXT.test(message);
}

export interface GroupChatAccessInput {
  /**
   * The database's own answer to "can this person read this chat's messages"
   * (`can_access_chat_group`), or `null` when it could not be asked: the read
   * failed, is still in flight, or the chat is served by the canister instead.
   */
  serverDecision: boolean | null;
  /** The chat's own details are readable, so the thread really exists. */
  chatVisible: boolean;
  /** Refusal raised by the message read itself (canister mode). */
  messageReadError?: unknown;
}

/** What the chat screen should render for this person. */
export function resolveGroupChatAccess(input: GroupChatAccessInput): GroupChatAccess {
  // A canister refusal is authoritative on its own: the chat's details may be
  // hidden for the same reason, so there is nothing else to wait for.
  if (isChatAccessDeniedError(input.messageReadError)) return "denied";
  // Supabase hides rows silently, so the permission read is the only signal —
  // and it only counts while the chat itself is on screen.
  if (input.serverDecision === false && input.chatVisible) return "denied";
  if (input.serverDecision === true) return "granted";
  return "unknown";
}
