/**
 * Instrumentation for the Messages inbox open path.
 *
 * Mirrors `chatOpenLatency.ts` but scoped to the /messages route so we can
 * attribute "inbox is slow to open" between:
 *   - cold-start stages (boot / notif_tap / auth_ready)
 *   - inbox_mount (component actually rendered)
 *   - inbox_bootstrap_return (messages-page bootstrap RPC resolved)
 *   - inbox_first_paint (first conversation row painted)
 *
 * Also records whether the disk cache was hit, whether the bootstrap RPC
 * kill-switch is engaged, and a coarse section-count snapshot so we can spot
 * outliers (users with many teams/clubs/groups where hydrate dominates).
 *
 * Best-effort — any failure is swallowed. One sample per page open, gated
 * by an in-module flag so re-renders don't multi-log.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole } from "./coldStartMarks";

export type InboxPerfSource = "cold_open" | "warm_nav" | "notification";

interface LogArgs {
  source: InboxPerfSource;
  /** Reference timestamp (ms epoch) — when the inbox open started (route landing / tap). */
  startTs: number;
  cacheHit: boolean;
  bootstrapEnabled: boolean;
  sectionCounts: {
    teams: number;
    clubs: number;
    groups: number;
    dms: number;
    total: number;
  };
  userId?: string | null;
}

let logged = false;

/** Reset when the user leaves /messages so the next open logs again. */
export function resetInboxOpenLog(): void {
  logged = false;
}

export async function logInboxOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (logged) return;
    if (!args.userId) return;
    logged = true;

    coldMark("inbox_first_paint");
    const tap_to_paint_ms = Math.max(0, Math.round(Date.now() - args.startTs));
    if (tap_to_paint_ms > 60_000) return; // sanity bound

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    const snap = snapshotStages();
    const deltas = snap.deltas;
    const bootstrap_ms =
      deltas.inbox_bootstrap_return != null && deltas.inbox_mount != null
        ? Math.max(0, deltas.inbox_bootstrap_return - deltas.inbox_mount)
        : null;
    const first_paint_ms =
      deltas.inbox_first_paint != null && deltas.inbox_mount != null
        ? Math.max(0, deltas.inbox_first_paint - deltas.inbox_mount)
        : null;

    const stages = snap.anchor !== null
      ? { anchor: snap.anchor, nav_ms: snap.nav_ms ?? 0, ...deltas, total_ms: tap_to_paint_ms }
      : null;

    logStagesToConsole(`inboxOpen:${args.source}`);

    const doInsert = () => {
      void supabase.from("inbox_open_perf").insert({
        user_id: args.userId!,
        source: args.source,
        tap_to_paint_ms,
        bootstrap_ms,
        first_paint_ms,
        cache_hit: args.cacheHit,
        bootstrap_enabled: args.bootstrapEnabled,
        section_counts: args.sectionCounts as any,
        platform,
        stages: stages as any,
      }).then(() => {}, () => {});
    };

    const w = window as any;
    if (typeof w?.requestIdleCallback === "function") {
      w.requestIdleCallback(doInsert, { timeout: 4000 });
    } else {
      setTimeout(doInsert, 2000);
    }
  } catch {
    // ignore
  }
}
