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

type MembershipVerdict = "yes" | "no" | "error";

/**
 * Verifies the user actually belongs to `clubId` before we move the global
 * filter there.
 *
 * `user_roles` alone is NOT sufficient: plenty of legitimate members (parents,
 * players carried in on a roster) hold only team-scoped rows, or rows whose
 * `club_id` is null. Rejecting those silently left the app filtered to the old
 * club while the notification's thread was open — the reported bug. So we also
 * accept a team membership that resolves to the club, and a club_players row.
 *
 * Returns "error" (not "no") when every lookup failed, so the caller can retry
 * rather than dropping the switch.
 */
async function verifyClubMembership(userId: string, clubId: string): Promise<MembershipVerdict> {
  let sawError = false;

  const roleRes = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .limit(1);
  if (roleRes.error) sawError = true;
  else if (roleRes.data && roleRes.data.length > 0) return "yes";

  // `as any` on the client: the embedded-join generics here trip TS2589
  // (excessively deep instantiation) against the generated Supabase types.
  const db = supabase as any;

  // PRIMARY missing path. `useClubTheme` builds both `availableClubThemes` and
  // `userClubs` from a UNION of `user_roles.club_id` AND
  // `user_roles.team_id -> teams.club_id`. A team-scoped role row has
  // `club_id = NULL`, so the direct check above rejects members the rest of the
  // app treats as belonging to the club — which is exactly why the switch was
  // silently dropped. Mirror the union here.
  const teamRoleRes = await db
    .from("user_roles")
    .select("id, teams!inner(club_id)")
    .eq("user_id", userId)
    .not("team_id", "is", null)
    .eq("teams.club_id", clubId)
    .limit(1);
  if (teamRoleRes.error) sawError = true;
  else if (teamRoleRes.data && teamRoleRes.data.length > 0) return "yes";

  const teamRes = await db
    .from("team_memberships")
    .select("id, teams!inner(club_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("teams.club_id", clubId)
    .limit(1);
  if (teamRes.error) sawError = true;
  else if (teamRes.data && teamRes.data.length > 0) return "yes";

  const playerRes = await db
    .from("club_players")
    .select("id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .limit(1);
  if (playerRes.error) sawError = true;
  else if (playerRes.data && playerRes.data.length > 0) return "yes";

  if (sawError) {
    console.warn("[NotificationClubSwitch] membership check incomplete", {
      roles: roleRes.error?.message,
      teamRoles: teamRoleRes.error?.message,
      teams: teamRes.error?.message,
      players: playerRes.error?.message,
    });
    return "error";
  }
  return "no";
}

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
