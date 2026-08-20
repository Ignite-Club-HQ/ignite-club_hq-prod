import { useRef } from "react";
import type { ChatMetadataState } from "@/lib/chatMetadataGate";

/**
 * Latches a chat page's metadata gate once it has resolved to "ready".
 *
 * The raw gate returns "loading" whenever the metadata row is momentarily
 * absent while the query is fetching (invalidation, focus/reconnect refetch,
 * cache eviction). Because the page-level gate is a top-of-render early
 * return, that flip unmounts the ENTIRE chat surface — including the
 * virtualized list's internal reveal state — so the user sees
 * messages → blank → skeleton → messages.
 *
 * Once a chat has rendered with real metadata, it must never fall back to the
 * skeleton for the same thread. Error/missing states are still allowed through
 * so genuinely deleted/unreachable threads surface correctly.
 */
export function useStickyChatMetadataState(
  state: ChatMetadataState,
  threadId: string | null | undefined,
): ChatMetadataState {
  const readyThreadRef = useRef<string | null>(null);

  if (state === "ready") {
    readyThreadRef.current = threadId ?? null;
    return state;
  }

  if (state === "loading" && readyThreadRef.current === (threadId ?? null) && readyThreadRef.current !== null) {
    // Already rendered this thread with metadata in hand — keep it rendered.
    return "ready";
  }

  if (state !== "loading") {
    readyThreadRef.current = null;
  }

  return state;
}
