/**
 * Measures notification-tap → first-message-render latency for chat threads
 * and writes one sample to `chat_open_perf` per page open. Best-effort: any
 * failure is swallowed so analytics never affects UX.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

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
    const tap_to_render_ms = Math.max(0, Math.round(Date.now() - args.startTs));
    // Sanity bound — drop anything over 60s (likely the user navigated elsewhere first)
    if (tap_to_render_ms > 60_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

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
