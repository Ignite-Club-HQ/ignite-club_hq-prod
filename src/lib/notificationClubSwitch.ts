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
import { resolveRouteClubScope } from "@/lib/routeClubScope";

const SS_KEY = "ignite_pending_notification_club_switch";
const APPLIED_KEY = "ignite_notification_club_switch_applied";
/**
 * Short-TTL "switch in flight" marker. `APPLIED_KEY` is only written after
 * membership verification (up to 4 round trips), but navigation happens
 * immediately — so `useClubScopeGuard` could bounce a legitimate cross-club
 * notification target home before the switch landed. This marker closes that
 * window.
 */
const INFLIGHT_KEY = "ignite_notification_club_switch_inflight";
const EVENT = "ignite:notification-club-switch";
/** Stale pending switches must never hijack a later, unrelated session. */
const TTL_MS = 120_000;
const INFLIGHT_TTL_MS = 30_000;

interface PendingSwitch {
  clubId: string;
  ts: number;
}

export function clearPendingNotificationClubSwitch(): void {
  try { sessionStorage.removeItem(SS_KEY); } catch { /* noop */ }
}

function markNotificationClubSwitchInFlight(clubId: string): void {
  try {
    sessionStorage.setItem(INFLIGHT_KEY, JSON.stringify({ clubId, ts: Date.now() } satisfies PendingSwitch));
  } catch { /* noop */ }
}

export function clearNotificationClubSwitchInFlight(): void {
  try { sessionStorage.removeItem(INFLIGHT_KEY); } catch { /* noop */ }
}

/**
 * True when a notification-driven switch to `clubId` was requested and has not
 * finished reconciling yet. Consumed by `useClubScopeGuard` so it never bounces
 * a route whose club is about to become active.
 */
export function isNotificationClubSwitchInFlight(clubId: string | null | undefined): boolean {
  if (!clubId) return false;
  try {
    const raw = sessionStorage.getItem(INFLIGHT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as PendingSwitch;
    if (!parsed?.clubId) return false;
    if (Date.now() - parsed.ts > INFLIGHT_TTL_MS) {
      clearNotificationClubSwitchInFlight();
      return false;
    }
    return parsed.clubId === clubId;
  } catch {
    return false;
  }
}


/**
 * Records that a notification-driven club switch has been APPLIED.
 *
 * `useClubTheme` re-asserts `activeClubTheme` from localStorage / the profile
 * row during its async bootstrap. On a cold-start notification tap that
 * bootstrap can finish *after* the switch, silently dragging the filter back to
 * the previously selected club (the reported bug: Bridgewater thread open, app
 * still filtered to Basket Range). The provider consults this marker and treats
 * it as authoritative for its TTL instead of clobbering the switch.
 */
export function markNotificationClubSwitchApplied(clubId: string): void {
  try {
    sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ clubId, ts: Date.now() } satisfies PendingSwitch));
  } catch { /* noop */ }
}

/** The club id of a recently applied notification switch, or null. */
export function getAppliedNotificationClubSwitch(): string | null {
  try {
    const raw = sessionStorage.getItem(APPLIED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSwitch;
    if (!parsed?.clubId) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      clearAppliedNotificationClubSwitch();
      return null;
    }
    return parsed.clubId;
  } catch {
    return null;
  }
}

export function clearAppliedNotificationClubSwitch(): void {
  try { sessionStorage.removeItem(APPLIED_KEY); } catch { /* noop */ }
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

/**
 * Resolve the owning club for an already-resolved chat target (in-app
 * notification bell taps, where we have kind + targetId rather than a raw push
 * payload). DM/broadcast are not club-scoped and resolve to `null`.
 */
export async function resolveClubIdForChatTarget(
  kind: ChatJumpKind,
  targetId: string | null,
): Promise<string | null> {
  try {
    if (!targetId) return null;
    if (kind === "club") return targetId;
    if (kind === "team") {
      const { data } = await supabase.from("teams").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    if (kind === "group") {
      const { data } = await supabase.from("chat_groups").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    if (kind === "club_admin") {
      const { data } = await supabase
        .from("club_admin_conversations").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    return null;
  } catch (err) {
    console.warn("[NotificationClubSwitch] target resolve failed", err);
    return null;
  }
}

/**
 * Bell-tap entry point: stash the pending club switch BEFORE navigating where
 * practical, so the destination thread does not render under the wrong club
 * context. Bounded by `timeoutMs` — navigation is never blocked for long, and a
 * slow lookup still stashes (and is drained by `useNotificationClubSwitch`)
 * once it resolves.
 */
export async function requestClubSwitchForChatTarget(
  kind: ChatJumpKind,
  targetId: string | null,
  timeoutMs = 600,
): Promise<void> {
  if (typeof window === "undefined") return;
  const resolving = resolveClubIdForChatTarget(kind, targetId).then((clubId) => {
    if (clubId) stash(clubId);
  });
  await Promise.race([
    resolving,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
