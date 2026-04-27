import { useEffect, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

interface Options<TMsg extends { id: string }> {
  /** Current search query from the search bar */
  searchQuery: string;
  /** Currently loaded messages */
  loadedMessages: TMsg[] | undefined;
  /** Setter to merge fetched historical matches into local state */
  setMessages: (updater: (prev: TMsg[] | undefined) => TMsg[] | undefined) => void;
  /**
   * Fetch matching messages from the DB. Should be the SAME shape the page
   * already loads (profiles, reactions, reply_to, etc.) so they render correctly.
   * Receives the trimmed query string and a `signal` for cancellation.
   */
  fetcher: (query: string, signal: AbortSignal) => Promise<TMsg[]>;
  /** Disable when missing context (e.g. before ids are ready) */
  enabled?: boolean;
  /** Min characters before searching */
  minChars?: number;
  /** Stable cache key — when this changes, last-query memo resets */
  cacheKey?: string;
}

/**
 * Fetches additional historical messages from the DB matching `searchQuery` and
 * merges them into the page's local message state. This lets chat search cover
 * the full message history (not just the messages already paginated into memory).
 *
 * The page's existing client-side `searchQuery.includes` filter then narrows
 * the merged set, and `highlightText` highlights matches in the rendered output.
 */
export function useChatHistorySearch<TMsg extends { id: string }>({
  searchQuery,
  loadedMessages,
  setMessages,
  fetcher,
  enabled = true,
  minChars = 2,
  cacheKey = "",
}: Options<TMsg>) {
  const debouncedQuery = useDebounce(searchQuery, 350);
  const lastQueryRef = useRef<string>("");
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!enabled || trimmed.length < minChars) {
      lastQueryRef.current = "";
      setIsSearching(false);
      return;
    }

    const memoKey = `${cacheKey}|${trimmed}`;
    if (lastQueryRef.current === memoKey) {
      setIsSearching(false);
      return;
    }
    lastQueryRef.current = memoKey;

    const controller = new AbortController();
    setIsSearching(true);
    (async () => {
      try {
        const fetched = await fetcher(trimmed, controller.signal);
        if (controller.signal.aborted || !fetched?.length) return;

        setMessages((prev) => {
          if (!prev) return fetched;
          const existing = new Set(prev.map((m) => m.id));
          const additions = fetched.filter((m) => m.id && !existing.has(m.id));
          if (additions.length === 0) return prev;
          return [...prev, ...additions];
        });
      } catch {
        // Best-effort; ignore
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, enabled, cacheKey]);

  return { isSearching };
}
