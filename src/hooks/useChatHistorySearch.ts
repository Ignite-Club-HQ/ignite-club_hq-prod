import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";

type ChatTable =
  | "team_messages"
  | "club_messages"
  | "group_messages"
  | "broadcast_messages"
  | "club_admin_messages"
  | "direct_messages";

interface Options<TMsg extends { id: string; created_at: string; text: string | null }> {
  /** Table name to search */
  table: ChatTable;
  /** Column + value pairs to scope the search (e.g. team_id, club_id, conversation_id) */
  scope: Record<string, string | null | undefined>;
  /** Current search query from the search bar */
  searchQuery: string;
  /** Currently loaded messages (newest-or-oldest order, doesn't matter — we use ids) */
  loadedMessages: TMsg[] | undefined;
  /** Setter to merge fetched historical matches into local state */
  setMessages: (updater: (prev: TMsg[] | undefined) => TMsg[] | undefined) => void;
  /** SELECT projection — should match what the page already loads */
  select: string;
  /** Optional max results to fetch */
  limit?: number;
  /** Disable when missing context */
  enabled?: boolean;
}

/**
 * Fetches additional historical messages from the DB matching `searchQuery` and
 * merges them into the page's local message state. This lets chat search cover
 * the full message history (not just the messages already paginated into memory).
 *
 * The page's existing client-side `searchQuery.includes` filter then narrows
 * the merged set, and `highlightText` highlights matches in the rendered output.
 */
export function useChatHistorySearch<
  TMsg extends { id: string; created_at: string; text: string | null }
>({
  table,
  scope,
  searchQuery,
  loadedMessages,
  setMessages,
  select,
  limit = 100,
  enabled = true,
}: Options<TMsg>) {
  const debouncedQuery = useDebounce(searchQuery, 350);
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!enabled || trimmed.length < 2) {
      lastQueryRef.current = "";
      return;
    }
    // Skip if scope columns aren't ready
    const scopeReady = Object.values(scope).every((v) => v !== undefined && v !== null && v !== "");
    if (!scopeReady) return;

    // Avoid refetch storms on identical query
    const key = `${table}|${JSON.stringify(scope)}|${trimmed}`;
    if (lastQueryRef.current === key) return;
    lastQueryRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        // Escape % and _ for ilike
        const safe = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
        let q = supabase
          .from(table as never)
          .select(select)
          .ilike("text", `%${safe}%`)
          .order("created_at", { ascending: false })
          .limit(limit);

        for (const [col, val] of Object.entries(scope)) {
          q = (q as never as { eq: (c: string, v: unknown) => typeof q }).eq(col, val as string);
        }

        const { data, error } = await q;
        if (cancelled || error || !data) return;

        const fetched = data as unknown as TMsg[];
        const existingIds = new Set((loadedMessages ?? []).map((m) => m.id));
        const additions = fetched.filter((m) => m.id && !existingIds.has(m.id));
        if (additions.length === 0) return;

        setMessages((prev) => {
          if (!prev) return fetched;
          const ids = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const m of additions) {
            if (!ids.has(m.id)) merged.push(m);
          }
          return merged;
        });
      } catch {
        // Silently ignore — search is best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, table, JSON.stringify(scope), enabled]);
}
