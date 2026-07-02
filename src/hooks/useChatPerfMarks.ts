import { useEffect } from "react";
import { mark as coldMark } from "@/lib/coldStartMarks";

/**
 * Emits `chat_mount` once when a chat page mounts and `chat_query_return`
 * the first time its messages query resolves. These marks feed
 * `chat_open_perf.stages` so we can attribute cold-start latency between
 * route landing, first RPC return, and first paint.
 */
export function useChatPerfMarks(messagesData: unknown): void {
  useEffect(() => {
    coldMark("chat_mount");
  }, []);

  useEffect(() => {
    if (messagesData !== undefined && messagesData !== null) {
      coldMark("chat_query_return");
    }
  }, [messagesData]);
}
