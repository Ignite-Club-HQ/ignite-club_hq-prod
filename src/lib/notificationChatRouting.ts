import { supabase } from "@/integrations/supabase/client";
import type { ChatJumpKind } from "@/lib/pendingChatJump";

/**
 * Shared resolution of a notification's `related_id` (a message id) to an
 * accessible chat destination.
 *
 * Every lookup is RLS-scoped, so a deleted or inaccessible message simply
 * resolves to `null`. Callers MUST treat `null` as "route to the safe
 * fallback" (`NOTIFICATION_FALLBACK_PATH`) and must never build a route from
 * an unverified id.
 */

export type ChatTarget = {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
  path: string;
};

/** Safe destination when a referenced message cannot be resolved. */
export const NOTIFICATION_FALLBACK_PATH = "/messages";

export const chatTargetPath = (kind: ChatJumpKind, targetId: string | null, messageId: string) => {
  switch (kind) {
    case "team": return targetId ? `/messages/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club": return targetId ? `/messages/club/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "group": return targetId ? `/groups/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "dm": return targetId ? `/messages/dm/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club_admin": return targetId ? `/messages/club-admin/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "broadcast": return `/messages/broadcast?message=${messageId}`;
    default: return NOTIFICATION_FALLBACK_PATH;
  }
};

// "No rows" / RLS-hidden results arrive as `data: null` with no error via
// maybeSingle(). Anything else is unexpected and worth a non-sensitive log.
function logUnexpected(table: string, error: unknown) {
  if (!error) return;
  const code = (error as { code?: string }).code;
  // PGRST116 = no rows for single(); treat as an expected miss.
  if (code === "PGRST116") return;
  console.warn("[NotificationRouting] lookup failed", { table, code: code ?? "unknown" });
}

export async function resolveChatTargetForMessageId(messageId: string): Promise<ChatTarget | null> {
  if (!messageId) return null;

  try {
    const { data: tMsg, error: tErr } = await supabase.from("team_messages").select("team_id").eq("id", messageId).maybeSingle();
    logUnexpected("team_messages", tErr);
    if (tMsg?.team_id) return { kind: "team", targetId: tMsg.team_id, messageId, path: chatTargetPath("team", tMsg.team_id, messageId) };

    const { data: cMsg, error: cErr } = await supabase.from("club_messages").select("club_id").eq("id", messageId).maybeSingle();
    logUnexpected("club_messages", cErr);
    if (cMsg?.club_id) return { kind: "club", targetId: cMsg.club_id, messageId, path: chatTargetPath("club", cMsg.club_id, messageId) };

    const { data: gMsg, error: gErr } = await supabase.from("group_messages").select("group_id").eq("id", messageId).maybeSingle();
    logUnexpected("group_messages", gErr);
    if (gMsg?.group_id) return { kind: "group", targetId: gMsg.group_id, messageId, path: chatTargetPath("group", gMsg.group_id, messageId) };

    const { data: dMsg, error: dErr } = await supabase.from("direct_messages").select("conversation_id").eq("id", messageId).maybeSingle();
    logUnexpected("direct_messages", dErr);
    if (dMsg?.conversation_id) return { kind: "dm", targetId: dMsg.conversation_id, messageId, path: chatTargetPath("dm", dMsg.conversation_id, messageId) };

    const { data: bMsg, error: bErr } = await supabase.from("broadcast_messages").select("id").eq("id", messageId).maybeSingle();
    logUnexpected("broadcast_messages", bErr);
    if (bMsg?.id) return { kind: "broadcast", targetId: null, messageId, path: chatTargetPath("broadcast", null, messageId) };

    const { data: caMsg, error: caErr } = await supabase.from("club_admin_messages").select("conversation_id").eq("id", messageId).maybeSingle();
    logUnexpected("club_admin_messages", caErr);
    if (caMsg?.conversation_id) return { kind: "club_admin", targetId: caMsg.conversation_id, messageId, path: chatTargetPath("club_admin", caMsg.conversation_id, messageId) };
  } catch (err) {
    console.warn("[NotificationRouting] unexpected resolution failure", {
      reason: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }

  return null;
}
