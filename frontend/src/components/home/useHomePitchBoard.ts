import { useCallback, useEffect, useRef, useState } from "react";
import type { HomePitchBoardTeam } from "./HomePitchBoardRuntime";

interface HomePitchBoardMember {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface HomePitchBoardChild {
  child_id: string;
  child_name: string;
}

interface HomePitchBoardRsvp {
  user_id: string | null;
  child_id: string | null;
}

interface UseHomePitchBoardArgs {
  isAppAdmin: boolean;
  notifyProRequired: () => void;
  hasProFootballAccess: (teamId: string) => Promise<boolean>;
  loadRoster: (teamId: string) => Promise<{
    members: HomePitchBoardMember[];
    children: HomePitchBoardChild[];
  }>;
  findNearbyEvent: (teamId: string) => Promise<string | null>;
  loadGoingRsvps: (eventId: string) => Promise<HomePitchBoardRsvp[]>;
  onLoadFailed?: () => void;
}

const STAFF_ROLES = new Set([
  "team_admin",
  "coach",
  "club_admin",
  "app_admin",
]);

/** Bound a live read so a stalled canister call becomes a retryable error, not an endless spinner. */
const LOAD_DEADLINE_MS = 10_000;
const MAX_ATTEMPTS = 3;

function withLoadDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("The pitch board took too long to load.")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function useHomePitchBoard({
  isAppAdmin,
  notifyProRequired,
  hasProFootballAccess,
  loadRoster,
  findNearbyEvent,
  loadGoingRsvps,
  onLoadFailed,
}: UseHomePitchBoardArgs) {
  const [pitchBoardTeam, setPitchBoardTeam] =
    useState<HomePitchBoardTeam | null>(null);
  const [pitchBoardLoading, setPitchBoardLoading] = useState(false);
  const requestIdRef = useRef(0);
  const pendingRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const dependenciesRef = useRef({
    isAppAdmin,
    notifyProRequired,
    hasProFootballAccess,
    loadRoster,
    findNearbyEvent,
    loadGoingRsvps,
    onLoadFailed,
  });
  dependenciesRef.current = {
    isAppAdmin,
    notifyProRequired,
    hasProFootballAccess,
    loadRoster,
    findNearbyEvent,
    loadGoingRsvps,
    onLoadFailed,
  };

  const openPitchBoard = useCallback(
    (teamId: string, teamName: string, readOnly = false, eventId?: string | null): Promise<void> => {
      const key = JSON.stringify([teamId, teamName, readOnly, eventId]);
      if (pendingRef.current?.key === key) return pendingRef.current.promise;
      const requestId = ++requestIdRef.current;
      const isCurrent = () => requestIdRef.current === requestId;
      setPitchBoardLoading(true);
      const promise = (async () => {
      try {
          const dependencies = dependenciesRef.current;
          // Each read has its own deadline: several healthy sequential reads
          // must not exhaust one shared ten-second budget. Retry only the
          // failed read, never restart successful roster/attendance requests.
          const read = async <T,>(load: () => Promise<T>): Promise<T> => {
            for (let attempt = 0; ; attempt++) {
              if (!isCurrent()) throw new Error("Pitch board opening cancelled");
              try {
                return await withLoadDeadline(load(), LOAD_DEADLINE_MS);
              } catch (error) {
                if (!isCurrent() || attempt >= MAX_ATTEMPTS - 1) throw error;
              }
            }
          };
          const hasAccess = dependencies.isAppAdmin || await read(() => dependencies.hasProFootballAccess(teamId));
          if (!isCurrent()) return;
          if (!hasAccess && !dependencies.isAppAdmin) {
            dependencies.notifyProRequired();
            return;
          }

          // Download the board alongside its data, not after all roster reads.
          // The rendered lazy component still owns visible import recovery.
          void import("@/components/pitch/PitchBoard").catch(() => {});

          // The widget already knows its exact match. Other entry points still
          // discover a nearby match. Attendance starts as soon as that resolves,
          // rather than waiting for the slower decrypted team roster first.
          const attendance = async () => {
            const linkedEventId = eventId !== undefined
              ? eventId
              : await read(() => dependencies.findNearbyEvent(teamId));
            const rsvps = linkedEventId
              ? await read(() => dependencies.loadGoingRsvps(linkedEventId))
              : null;
            return { linkedEventId, rsvps };
          };
          const [roster, { linkedEventId, rsvps }] = await Promise.all([
            read(() => dependencies.loadRoster(teamId)),
            attendance(),
          ]);
          if (!isCurrent()) return;
          const goingChildIds = rsvps ? new Set(
              rsvps
                .map((rsvp) => rsvp.child_id)
                .filter((id): id is string => !!id),
            ) : null;
          const goingAdultIds = rsvps ? new Set(
              rsvps
                .map((rsvp) => rsvp.user_id)
                .filter((id): id is string => !!id),
            ) : null;

          const members = roster.members.filter(
            (member) =>
              !goingAdultIds ||
              STAFF_ROLES.has(member.role) ||
              goingAdultIds.has(member.user_id),
          );
          const children = roster.children
            .filter(
              (child) =>
                !goingChildIds || goingChildIds.has(child.child_id),
            )
            .map((child): HomePitchBoardMember => ({
              id: `child-${child.child_id}`,
              user_id: child.child_id,
              role: "player",
              profiles: {
                display_name: child.child_name,
                avatar_url: null,
              },
            }));

          setPitchBoardTeam({
            id: teamId,
            name: teamName,
            members: [...members, ...children],
            readOnly,
            linkedEventId,
          });
      } catch {
        if (isCurrent()) dependenciesRef.current.onLoadFailed?.();
      } finally {
        if (isCurrent()) {
          pendingRef.current = null;
          setPitchBoardLoading(false);
        }
      }
      })();
      pendingRef.current = { key, promise };
      return promise;
    },
    [],
  );

  useEffect(() => () => {
    ++requestIdRef.current;
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    const handleOpenPitchBoard = () => {
      try {
        const timerStateRaw = localStorage.getItem("pitch-board-timer-state");
        if (!timerStateRaw) return;
        const timerState = JSON.parse(timerStateRaw);
        if (timerState?.teamId && timerState?.teamName) {
          void openPitchBoard(timerState.teamId, timerState.teamName, false,
            typeof timerState.eventId === "string" || timerState.eventId === null ? timerState.eventId : undefined);
        }
      } catch {
        // Invalid or unavailable persisted state is ignored.
      }
    };
    window.addEventListener("open-pitch-board", handleOpenPitchBoard);
    return () =>
      window.removeEventListener("open-pitch-board", handleOpenPitchBoard);
  }, [openPitchBoard]);

  useEffect(() => {
    let cancelled = false;
    const tryRestore = () => {
      if (cancelled || pitchBoardTeam) return;
      try {
        if (localStorage.getItem("ignite-pitch-board-open") !== "true") return;
        const storedPath = localStorage.getItem("ignite-pitch-board-open-path");
        const isHomePath =
          !storedPath ||
          storedPath === "/" ||
          storedPath === "/home" ||
          storedPath.startsWith("/?") ||
          storedPath.startsWith("/home?");
        if (!isHomePath) return;

        const contextRaw = localStorage.getItem(
          "ignite-pitch-board-last-context",
        );
        if (!contextRaw) return;
        const context = JSON.parse(contextRaw);
        if (context?.teamId && context?.teamName) {
          const timerRaw = localStorage.getItem(`pitch-board-timer-state-team-${context.teamId}`)
            ?? localStorage.getItem("pitch-board-timer-state");
          let eventId: string | null | undefined;
          try {
            const timer = timerRaw ? JSON.parse(timerRaw) : null;
            if (timer?.teamId === context.teamId && (typeof timer.eventId === "string" || timer.eventId === null)) {
              eventId = timer.eventId;
            }
          } catch { /* A bad saved timer does not prevent authorized discovery. */ }
          void openPitchBoard(
            context.teamId,
            context.teamName,
            !!context.readOnly,
            eventId,
          );
        }
      } catch {
        // Invalid or unavailable persisted state is ignored.
      }
    };

    tryRestore();
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener(
          "appStateChange",
          ({ isActive }) => isActive && tryRestore(),
        );
        if (cancelled) {
          void handle.remove();
        } else {
          removeListener = () => {
            void handle.remove();
          };
        }
      } catch {
        // Native lifecycle is optional on web.
      }
    })();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") tryRestore();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      removeListener?.();
    };
  }, [openPitchBoard, pitchBoardTeam]);

  return {
    pitchBoardTeam,
    pitchBoardLoading,
    openPitchBoard,
    closePitchBoard: () => {
      ++requestIdRef.current;
      pendingRef.current = null;
      setPitchBoardLoading(false);
      setPitchBoardTeam(null);
    },
  };
}
