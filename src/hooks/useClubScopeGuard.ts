import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClubTheme } from "@/hooks/useClubTheme";
import { getAppliedNotificationClubSwitch } from "@/lib/notificationClubSwitch";
import { resolveRouteClubScope } from "@/lib/routeClubScope";

/**
 * Club scope guard.
 *
 * Mounted once in `AppLayout`. When the active club filter points at club B but
 * the currently open route renders content owned by club A, the user is sent
 * back to the home page. Without this, switching the club theme leaves the
 * previous club's team/chat/event/vault content on screen.
 *
 * Deliberately conservative:
 *  - Only acts when a specific club is selected (`activeClubFilter` non-null).
 *  - Only acts when the route's owning club resolves to a real, different id —
 *    NULL / unknown / still-loading never redirects.
 *  - Honours the notification club-switch pin so a push-driven navigation into
 *    another club's thread isn't bounced before the filter reconciles.
 */
export function useClubScopeGuard() {
  const { activeClubFilter } = useClubTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const scope = resolveRouteClubScope(location.pathname);

  const needsLookup = scope.kind === "lookup";
  const lookupTable = scope.kind === "lookup" ? scope.table : null;
  const lookupId = scope.kind === "lookup" ? scope.id : null;

  const { data: lookedUpClubId, isFetched } = useQuery({
    queryKey: ["route-club-scope", lookupTable, lookupId],
    queryFn: async () => {
      if (!lookupTable || !lookupId) return null;
      const { data, error } = await supabase
        .from(lookupTable)
        .select("club_id")
        .eq("id", lookupId)
        .maybeSingle();
      // Fail open: an RLS/network error must never bounce the user.
      if (error) return null;
      return (data?.club_id as string | null) ?? null;
    },
    enabled: needsLookup && !!activeClubFilter,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const owningClubId =
    scope.kind === "direct"
      ? scope.clubId
      : needsLookup && isFetched
        ? (lookedUpClubId ?? null)
        : null;

  // Guard against redirect loops if "/" itself somehow resolved to a scope.
  const lastRedirectedFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!activeClubFilter || !owningClubId) return;
    if (owningClubId === activeClubFilter) return;
    // A push-notification driven switch is mid-reconciliation: let it settle.
    if (getAppliedNotificationClubSwitch() === owningClubId) return;
    if (location.pathname === "/") return;
    if (lastRedirectedFrom.current === location.pathname + "|" + activeClubFilter) return;
    lastRedirectedFrom.current = location.pathname + "|" + activeClubFilter;
    navigate("/", { replace: true });
  }, [activeClubFilter, owningClubId, location.pathname, navigate]);
}
