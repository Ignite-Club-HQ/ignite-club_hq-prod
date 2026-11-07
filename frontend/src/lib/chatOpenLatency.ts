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
import { withFeatureBackend } from "@/live/featureRouter";
import { recordLivePerfSamplesBatch } from "@/live/features/insights";
import { classifyChatOpen, takeChatOpenBreakdown, onChatStage, type ChatOpenBreakdown } from "./chatOpenTrace";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole, stopLongTaskWindow } from "./coldStartMarks";

export type ChatPerfKind = "dm" | "team" | "club" | "group";
/** Callers pass notification | cold_open; the logger relabels opens that
 *  painted from cache (or repeat opens this session) as cached_open. */
export type ChatPerfSource = "notification" | "cold_open" | "cached_open";

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

/** Chat mounts later than this after app start = the user browsed elsewhere
 *  first, so app-start time must not be counted as chat-open time. */
export const COLD_OPEN_MAX_MOUNT_MS = 5_000;

export function isTrueColdOpen(chatMountDeltaMs: number | undefined): boolean {
  // chat_mount is first-write-wins per session; a missing or late mark means
  // this chat was reached by in-app navigation, not opened at launch.
  return typeof chatMountDeltaMs === "number" && chatMountDeltaMs <= COLD_OPEN_MAX_MOUNT_MS;
}

export async function logChatOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (!args.userId) return;
    // Effects run after commit, not necessarily after pixels are visible.
    if (typeof requestAnimationFrame === "function") await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const renderTs = Date.now();
    // Record the render mark first so the stage snapshot includes it.
    coldMark("chat_render");
    const breakdown = takeChatOpenBreakdown(args.targetId, args.startTs, renderTs);
    const fromCache = args.fromCache || breakdown.read_path === "cache" || breakdown.read_path === "warm";
    const openClass = classifyChatOpen(args.targetId, args.source === "notification", fromCache);
    recordBreakdownLocally(args.kind, openClass, breakdown);
    // For cold_open, anchor startTs to the earliest signal we have (notif_tap
    // or performance.timeOrigin / boot) so tap_to_render_ms includes the
    // pre-mount prefix (native webview init, auth resolve, chunk fetch,
    // route settle). Callers pass mount-time for cold_open; override here.
    let startTs = args.startTs;
    if (args.source === "cold_open") {
      try {
        const snap = snapshotStages();
        if (snap.anchor !== null && isTrueColdOpen(snap.deltas.chat_mount)) {
          const notifDelta = snap.deltas.notif_tap;
          if (typeof notifDelta === "number") {
            startTs = Math.min(startTs, snap.anchor + notifDelta);
          } else if (typeof performance !== "undefined" && performance.timeOrigin) {
            startTs = Math.min(startTs, Math.round(performance.timeOrigin));
          } else {
            startTs = Math.min(startTs, snap.anchor);
          }
        }
      } catch {}
    }
    const tap_to_render_ms = Math.max(0, Math.round(Date.now() - startTs));
    // Sanity bound — drop anything over 60s (likely the user navigated elsewhere first)
    if (tap_to_render_ms > 60_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    // Snapshot per-stage deltas so we can attribute cold-start time.
    const stagesSnap = snapshotStages();
    // Stop main-thread longtask sampling window that started at notif_tap.
    // `blocked_ms` in the payload = cumulative >50ms tasks between the tap
    // and this first chat_render — attributes JS blocking vs I/O in the gap.
    const blockedMs = stopLongTaskWindow("notif_to_chat_mount");
    const stages = stagesSnap.anchor !== null
      ? {
          anchor: stagesSnap.anchor,
          nav_ms: stagesSnap.nav_ms ?? 0,
          ...stagesSnap.deltas,
          blocked_ms: blockedMs ?? undefined,
          total_ms: tap_to_render_ms,
        }
      : null;

    // Compact dev-only console line for quick local inspection.
    logStagesToConsole(`chatOpen:${args.kind}:${args.source}`);

    // Defer the insert until the browser is idle so it doesn't compete with
    // the messages fetch / first-paint critical path on notification opens.
    const doInsert = () => {
      void withFeatureBackend("analytics", {
        supabase: async () => { supabaseInsert(); },
        icp: async (ctx) => {
          // Legacy surface keeps the tap/launch anchor; chat_open_v2 is the
          // per-open tap→first-message total with honest cold/cached labels,
          // and chat_open_stage:* carries the stage split (durations only).
          await recordLivePerfSamplesBatch(ctx, [
            { surface: "chat_open", source: args.source, duration_ms: tap_to_render_ms, cache_hit: args.fromCache, platform },
            ...breakdownSamples(args.kind, openClass, breakdown, fromCache, platform),
          ]);
        },
      }, { shared: "app" }).catch(() => {});
    };
    const supabaseInsert = () => {
      void supabase.from("chat_open_perf").insert({
        user_id: args.userId,
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

    // Fire immediately — deferring drops writes on Android WebView when the app
    // is backgrounded before the idle/timeout callback runs.
    doInsert();
  } catch {
    // ignore
  }
}

const STAGE_KEYS = ["js_load_ms", "auth_wait_ms", "connect_ms", "authz_fallback_ms", "canister_ms", "render_ms", "enrichment_ms", "query_attempt_ms", "update_fallback_ms"] as const;

// Independent events survive a failed open and enrichment finishing after paint.
onChatStage(event => {
  try {
    const w = window as unknown as { __igniteChatStages?: unknown[] };
    (w.__igniteChatStages ??= []).push(event);
    if (w.__igniteChatStages.length > 500) w.__igniteChatStages.shift();
    // Batch at the next task so telemetry never starts an actor handshake
    // on the synchronous message decode/paint path.
    setTimeout(() => { void withFeatureBackend("analytics", {
      supabase: async () => {},
      icp: ctx => recordLivePerfSamplesBatch(ctx, [{ surface: `chat_read:${event.stage}`,
        source: event.reason ?? "completed", duration_ms: event.duration_ms, cache_hit: false,
        platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : /Android/i.test(navigator.userAgent) ? "android_web" : "web" }]),
    }, { shared: "app" }).catch(() => {}); }, 0);
  } catch { /* best-effort and contains no identities or raw errors */ }
});

export function breakdownSamples(kind: ChatPerfKind, openClass: string, b: ChatOpenBreakdown, fromCache: boolean, platform: string) {
  const source = `${kind}:${openClass}:${b.read_path ?? "unknown"}`;
  const out = [{ surface: "chat_open_v2", source, duration_ms: Math.min(b.total_ms, 600_000), cache_hit: fromCache, platform }];
  for (const key of STAGE_KEYS) {
    const v = b[key];
    if (typeof v === "number") out.push({ surface: `chat_open_stage:${key.replace(/_ms$/, "")}`, source, duration_ms: Math.min(v, 600_000), cache_hit: fromCache, platform });
  }
  return out;
}

/** In-page record for benchmarking (window.__igniteChatOpens); no ids. */
function recordBreakdownLocally(kind: ChatPerfKind, openClass: string, b: ChatOpenBreakdown) {
  try {
    const w = window as unknown as { __igniteChatOpens?: unknown[] };
    (w.__igniteChatOpens ??= []).push({ kind, open: openClass, ...b });
    if (w.__igniteChatOpens.length > 200) w.__igniteChatOpens.shift();
    console.info(`[perf] chat open ${kind}/${openClass}/${b.read_path ?? "?"}: ${b.total_ms}ms`, b);
  } catch { /* ignore */ }
}
