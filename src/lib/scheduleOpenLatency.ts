/**
 * Instrumentation for the Schedule (Events) screen open path.
 *
 * Mirrors `inboxOpenLatency.ts`. Scoped to `/events` so we can attribute
 * "schedule is slow to open" between cold-start stages, mount, primary
 * events query return, and first paint.
 *
 * One sample per page open. Any failure is swallowed.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole } from "./coldStartMarks";

export type SchedulePerfSource = "cold_open" | "warm_nav" | "notification";

interface LogArgs {
  source: SchedulePerfSource;
  startTs: number;
  cacheHit: boolean;
  context: {
    viewMode: "list" | "calendar";
    filter: string;
    clubFilter: string | null;
    teamFilter: string | null;
    eventCount: number;
  };
  userId?: string | null;
}

let logged = false;

export function resetScheduleOpenLog(): void {
  logged = false;
}

export async function logScheduleOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (logged) return;
    if (!args.userId) return;
    logged = true;

    coldMark("schedule_first_paint");
    const tap_to_paint_ms = Math.max(0, Math.round(Date.now() - args.startTs));
    if (tap_to_paint_ms > 60_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    const snap = snapshotStages();
    const deltas = snap.deltas;
    const query_ms =
      deltas.schedule_query_return != null && deltas.schedule_mount != null
        ? Math.max(0, deltas.schedule_query_return - deltas.schedule_mount)
        : null;
    const first_paint_ms =
      deltas.schedule_first_paint != null && deltas.schedule_mount != null
        ? Math.max(0, deltas.schedule_first_paint - deltas.schedule_mount)
        : null;

    const stages = snap.anchor !== null
      ? { anchor: snap.anchor, nav_ms: snap.nav_ms ?? 0, ...deltas, total_ms: tap_to_paint_ms }
      : null;

    logStagesToConsole(`scheduleOpen:${args.source}`);

    const doInsert = () => {
      void (supabase as any).from("schedule_open_perf").insert({
        user_id: args.userId!,
        source: args.source,
        tap_to_paint_ms,
        query_ms,
        first_paint_ms,
        cache_hit: args.cacheHit,
        context: args.context,
        platform,
        stages,
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
