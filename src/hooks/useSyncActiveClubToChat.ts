/**
 * useSyncActiveClubToChat
 *
 * When a user lands on a chat thread (via push notification, deep link, or
 * direct navigation), the global active-club filter must match the club that
 * owns the thread — otherwise notifications, badges and content for other
 * clubs would still show.
 *
 * Pass the chat's owning club id (once known). If it differs from the current
 * active club, this hook switches the active club to it.
 *
 * Safe to call with `null`/`undefined` — it's a no-op until a club id is known.
 */

import { useEffect, useRef } from "react";
import { useClubTheme } from "@/hooks/useClubTheme";

export function useSyncActiveClubToChat(clubId: string | null | undefined) {
  const { activeClubTheme, setActiveClubTheme, availableClubThemes } = useClubTheme();
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    if (lastSyncedRef.current === clubId) return;
    if (activeClubTheme === clubId) {
      lastSyncedRef.current = clubId;
      return;
    }
    // Only switch if the user actually has access to this club's theme entry
    // (avoids flipping into a club they were just removed from).
    const hasAccess = availableClubThemes.some((t) => t.clubId === clubId);
    if (!hasAccess) return;

    lastSyncedRef.current = clubId;
    setActiveClubTheme(clubId);
  }, [clubId, activeClubTheme, availableClubThemes, setActiveClubTheme]);
}
