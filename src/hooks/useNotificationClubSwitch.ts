/**
 * Applies a pending notification-driven club switch.
 *
 * Mounted inside `ClubThemeProvider` (via `PushNotificationManager`). Listens
 * for switch requests stashed by the native / web push tap handlers and, once
 * membership is verified, moves the global club filter to the club that owns
 * the tapped thread.
 *
 * Guards:
 *  - no-op when the requested club is already active;
 *  - membership is verified against `user_roles` before switching, so a stale
 *    or spoofed payload can never point the app at a club the user isn't in;
 *  - unresolved / failed verification leaves the current filter untouched;
 *  - a request that arrives during cold start survives in sessionStorage and is
 *    drained as soon as the user id is known.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  consumePendingNotificationClubSwitch,
  markNotificationClubSwitchApplied,
  peekPendingNotificationClubSwitch,
  subscribeNotificationClubSwitch,
} from "@/lib/notificationClubSwitch";

export function useNotificationClubSwitch() {
  const { user } = useAuth();
  const { activeClubTheme, setActiveClubTheme } = useClubTheme();

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const apply = async (clubId: string) => {
      if (cancelled) return;
      if (!clubId) {
        consumePendingNotificationClubSwitch();
        return;
      }
      if (clubId === activeClubTheme) {
        // Already correct — still mark it so the provider's async bootstrap
        // cannot drag the filter back to a previously stored club.
        markNotificationClubSwitchApplied(clubId);
        consumePendingNotificationClubSwitch();
        return;
      }
      try {
        const verified = await verifyClubMembership(user.id, clubId);
        if (verified === "error") {
          // Lookup failed (offline / flaky) — keep the request pending so the
          // next drain can retry instead of silently dropping the switch.
          return;
        }
        if (cancelled) return;
        consumePendingNotificationClubSwitch();
        if (verified === "no") return; // not a member — never switch
        console.log("[NotificationClubSwitch] switching active club", { from: activeClubTheme, to: clubId });
        markNotificationClubSwitchApplied(clubId);
        setActiveClubTheme(clubId);
      } catch (err) {
        console.warn("[NotificationClubSwitch] switch failed", err);
      }
    };

    // Drain anything stashed before mount (cold-start tap).
    const pending = peekPendingNotificationClubSwitch();
    if (pending) void apply(pending);

    const unsubscribe = subscribeNotificationClubSwitch((clubId) => void apply(clubId));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id, activeClubTheme, setActiveClubTheme]);
}
