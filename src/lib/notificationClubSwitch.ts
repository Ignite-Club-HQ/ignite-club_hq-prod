/**
 * Notification-driven active-club switching.
 *
 * Problem: when the app is filtered to Club A and the user taps a push for a
 * message in Club B, navigation opens the correct Club B thread but the global
 * club filter (header, home, inbox, media, schedule) stays on Club A. The user
 * ends up in a chat that "doesn't exist" according to every other surface.
 *
 * This module resolves the club that OWNS the tapped notification target and
 * stashes it as a pending switch. A consumer inside `ClubThemeProvider`
 * (`useNotificationClubSwitch`) verifies membership and applies it via
 * `setActiveClubTheme`.
 *
 * IMPORTANT — this does NOT violate the "chat pages must never mutate the
 * active club filter" rule (see `useSyncActiveClubToChat`). That rule targets
 * *rendering* a chat page. Here the mutation is caused by an explicit user
 * gesture (tapping a notification for another club), exactly like
 * `seedClubFilterFromInvite`. Nothing switches clubs on its own.
 */

import { supabase } from "@/integrations/supabase/client";
import { getJumpTarget, type ChatJumpKind } from "@/lib/pendingChatJump";

const SS_KEY = "ignite_pending_notification_club_switch";
const EVENT = "ignite:notification-club-switch";
/** Stale pending switches must never hijack a later, unrelated session. */
const TTL_MS = 120_000;

interface PendingSwitch {
  clubId: string;
  ts: number;
}

export function clearPendingNotificationClubSwitch(): void {
  try { sessionStorage.removeItem(SS_KEY); } catch { /* noop */ }
}

export function peekPendingNotificationClubSwitch(): string | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSwitch;
    if (!parsed?.clubId) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      clearPendingNotificationClubSwitch();
      return null;
    }
    return parsed.clubId;
  } catch {
    return null;
  }
}

/** Reads and clears the pending switch. */
export function consumePendingNotificationClubSwitch(): string | null {
  const clubId = peekPendingNotificationClubSwitch();
  if (clubId) clearPendingNotificationClubSwitch();
  return clubId;
}

function stash(clubId: string) {
  const payload: PendingSwitch = { clubId, ts: Date.now() };
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(payload)); } catch { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
  } catch { /* noop */ }
}

export function subscribeNotificationClubSwitch(handler: (clubId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PendingSwitch>).detail;
    if (detail?.clubId) handler(detail.clubId);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Resolves the owning club id for a tapped notification.
 *
 * Order of trust:
 *  1. Explicit `club_id` on the push payload (set by the senders).
 *  2. The chat jump target (team / group / club-admin conversation) resolved
 *     through an RLS-scoped lookup.
 *
 * Returns `null` when the club can't be determined — callers must then leave
 * the current filter untouched rather than guess.
 */
export async function resolveNotificationClubId(
  data: any,
  url: string | null | undefined,
): Promise<string | null> {
  try {
    const explicit = data?.club_id || data?.clubId;
    if (explicit && typeof explicit === "string") return explicit;

    const target = getJumpTarget(data, url);
    const kind: ChatJumpKind | null = target?.kind ?? null;
    const targetId = target?.targetId ?? null;

    if (kind === "club" && targetId) return targetId;

    if (kind === "team") {
      const teamId = targetId || data?.team_id || data?.teamId;
      if (!teamId) return null;
      const { data: team } = await supabase
        .from("teams").select("club_id").eq("id", teamId).maybeSingle();
      return (team as any)?.club_id ?? null;
    }

    if (kind === "group") {
      const groupId = targetId || data?.group_id || data?.groupId;
      if (!groupId) return null;
      const { data: group } = await supabase
        .from("chat_groups").select("club_id").eq("id", groupId).maybeSingle();
      return (group as any)?.club_id ?? null;
    }

    if (kind === "club_admin" && targetId) {
      const { data: convo } = await supabase
        .from("club_admin_conversations").select("club_id").eq("id", targetId).maybeSingle();
      return (convo as any)?.club_id ?? null;
    }

    // dm / broadcast are not club-scoped.
    return null;
  } catch (err) {
    console.warn("[NotificationClubSwitch] resolve failed", err);
    return null;
  }
}

/**
 * Entry point for push handlers: resolve the notification's club and stash it
 * as a pending switch. Fire-and-forget — never blocks navigation.
 */
export function requestClubSwitchForNotification(data: any, url: string | null | undefined): void {
  if (typeof window === "undefined") return;
  void resolveNotificationClubId(data, url).then((clubId) => {
    if (clubId) stash(clubId);
  });
}
