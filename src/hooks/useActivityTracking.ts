import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Generate a unique session ID per browser session
const SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Map route patterns to labels
function getPageLabel(path: string): string {
  if (path === "/" || path === "") return "Home";
  if (path.startsWith("/events/new")) return "Create Event";
  if (path.startsWith("/events/")) return "Event Detail";
  if (path === "/events") return "Events";
  if (path.startsWith("/teams/") && path.endsWith("/edit")) return "Edit Team";
  if (path.startsWith("/teams/") && path.endsWith("/upgrade")) return "Upgrade";
  if (path.startsWith("/teams/")) return "Team Detail";
  if (path === "/messages") return "Messages";
  if (path.startsWith("/messages/")) return "Chat";
  if (path.startsWith("/clubs/") && path.endsWith("/edit")) return "Edit Club";
  if (path.startsWith("/clubs/")) return "Club Detail";
  if (path === "/profile") return "Profile";
  if (path === "/settings") return "Settings";
  if (path.startsWith("/admin")) return "Admin";
  if (path.startsWith("/media")) return "Media";
  if (path.startsWith("/mini-leagues")) return "Mini Leagues";
  if (path.startsWith("/join")) return "Join";
  return path.split("/").filter(Boolean)[0] || "Unknown";
}

// Extract club_id from path if possible (e.g., /clubs/:id)
function extractClubIdFromPath(path: string): string | null {
  const clubMatch = path.match(/\/clubs\/([a-f0-9-]{36})/);
  return clubMatch?.[1] || null;
}

/**
 * Tracks user page views and active time.
 * Inserts a row when the user navigates to a page, then updates duration on leave.
 */
export function useActivityTracking() {
  const { user } = useAuth();
  const location = useLocation();
  const activeLogIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushDuration = useCallback(async () => {
    if (!activeLogIdRef.current) return;
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    if (elapsed < 1) return;

    try {
      await supabase
        .from("user_activity_logs" as any)
        .update({ duration_seconds: elapsed } as any)
        .eq("id", activeLogIdRef.current);
    } catch {
      // Silently fail - activity tracking is non-critical
    }
  }, []);

  const startTracking = useCallback(async (path: string) => {
    if (!user) return;

    // Flush previous
    await flushDuration();

    const clubId = extractClubIdFromPath(path);
    startTimeRef.current = Date.now();

    try {
      const { data } = await supabase
        .from("user_activity_logs" as any)
        .insert({
          user_id: user.id,
          page_path: path,
          page_label: getPageLabel(path),
          session_id: SESSION_ID,
          club_id: clubId,
          duration_seconds: 0,
        } as any)
        .select("id")
        .single();

      activeLogIdRef.current = (data as any)?.id || null;
    } catch {
      // Silently fail
    }
  }, [user, flushDuration]);

  // Track page changes
  useEffect(() => {
    if (!user) return;

    startTracking(location.pathname);

    // Periodically flush duration every 30s for long-lived pages
    flushIntervalRef.current = setInterval(flushDuration, 30_000);

    return () => {
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
      flushDuration();
    };
  }, [location.pathname, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on visibility change (tab switch, app background)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushDuration();
      }
    };

    const handleBeforeUnload = () => {
      flushDuration();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushDuration]);
}
