/**
 * Measures notification-tap → first-message-render latency for chat threads
 * and writes one sample to `chat_open_perf` per page open. Best-effort: any
 * failure is swallowed so analytics never affects UX.
 *
 * Also captures a per-stage breakdown from `coldStartMarks` (boot / notif_tap
 * / auth_ready) so we can attribute cold-start delay to the right layer
 * (Capacitor boot vs auth vs route waterfall vs thread fetch) before
 * committing to further prefetch optimisations.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole, stopLongTaskWindow } from "./coldStartMarks";

export type ChatPerfKind = "dm" | "team" | "club" | "group";
export type ChatPerfSource = "notification" | "cold_open";

interface LogArgs {
  kind: ChatPerfKind;
  targetId: string;
  source: ChatPerfSource;
  /** Reference timestamp (ms epoch). For `notification`, this is the tap time. */
  startTs: number;
  messageCount: number;
  fromCache: boolean;
  userId?: string | null;
}

export async function logChatOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (!args.userId) return;
    // Record the render mark first so the stage snapshot includes it.
    coldMark("chat_render");
    const tap_to_render_ms = Math.max(0, Math.round(Date.now() - args.startTs));
    // Sanity bound — drop anything over 60s (likely the user navigated elsewhere first)
    if (tap_to_render_ms > 60_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    // Snapshot per-stage deltas so we can attribute cold-start time.
    const stagesSnap = snapshotStages();
    const stages = stagesSnap.anchor !== null
      ? { anchor: stagesSnap.anchor, nav_ms: stagesSnap.nav_ms ?? 0, ...stagesSnap.deltas, total_ms: tap_to_render_ms }
      : null;

    // Compact dev-only console line for quick local inspection.
    logStagesToConsole(`chatOpen:${args.kind}:${args.source}`);

    // Defer the insert until the browser is idle so it doesn't compete with
    // the messages fetch / first-paint critical path on notification opens.
    const doInsert = () => {
      void supabase.from("chat_open_perf").insert({
        user_id: args.userId!,
        chat_kind: args.kind,
        target_id: args.targetId,
        source: args.source,
        tap_to_render_ms,
        message_count: args.messageCount,
        from_cache: args.fromCache,
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
