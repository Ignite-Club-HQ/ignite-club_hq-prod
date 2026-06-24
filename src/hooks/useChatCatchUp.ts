import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChatScopeType = "team" | "club" | "group" | "club_admin" | "direct";

export interface ChatSummaryPayload {
  headline: string;
  important_updates: string[];
  actions_needed: string[];
  schedule_changes: string[];
  people_mentioned: string[];
  files_shared: string[];
  unanswered_questions: string[];
}

export interface ChatSummaryResult {
  summary: ChatSummaryPayload;
  message_count: number;
  last_message_id: string | null;
  cached: boolean;
}

const LAST_OPENED_KEY = "chat-catchup:last-opened";
const DISMISSED_KEY = "chat-catchup:dismissed";
const UNREAD_MIN = 10;
const STALE_HOURS = 24;

function storeKey(scope_type: ChatScopeType, scope_id: string) {
  return `${scope_type}:${scope_id}`;
}

function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/** Persist that the user just opened this thread. Call on mount. */
export function markChatOpened(scope_type: ChatScopeType, scope_id: string) {
  if (!scope_id) return;
  const map = readMap(LAST_OPENED_KEY);
  map[storeKey(scope_type, scope_id)] = Date.now();
  writeMap(LAST_OPENED_KEY, map);
}

function getLastOpened(scope_type: ChatScopeType, scope_id: string): number | null {
  const map = readMap(LAST_OPENED_KEY);
  return map[storeKey(scope_type, scope_id)] ?? null;
}

function getDismissedFor(scope_type: ChatScopeType, scope_id: string): string | null {
  const map = readMap(DISMISSED_KEY) as unknown as Record<string, string>;
  return map[storeKey(scope_type, scope_id)] ?? null;
}

function setDismissedFor(scope_type: ChatScopeType, scope_id: string, marker: string) {
  const map = readMap(DISMISSED_KEY) as unknown as Record<string, string>;
  map[storeKey(scope_type, scope_id)] = marker;
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

interface UseChatCatchUpArgs {
  scope_type: ChatScopeType;
  scope_id: string | null | undefined;
  unreadCount?: number;
  /** Used to evaluate the "admin/coach broadcast generated multiple replies" trigger. */
  hasRecentBroadcastWithReplies?: boolean;
  /** When false, the inline card never shows (e.g. Pro gating not satisfied). */
  cardEnabled?: boolean;
  /** Identifier used to dedupe dismissal — usually latest message id. */
  latestMessageId?: string | null;
}

export function useChatCatchUp({
  scope_type,
  scope_id,
  unreadCount = 0,
  hasRecentBroadcastWithReplies = false,
  cardEnabled = true,
  latestMessageId = null,
}: UseChatCatchUpArgs) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatSummaryResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);

  // Evaluate eligibility for the inline card.
  const eligible = useMemo(() => {
    if (!scope_id || !cardEnabled) return false;
    const dismissed = getDismissedFor(scope_type, scope_id);
    if (dismissed && latestMessageId && dismissed === latestMessageId) return false;

    if (unreadCount >= UNREAD_MIN) return true;
    if (hasRecentBroadcastWithReplies) return true;

    const lastOpened = getLastOpened(scope_type, scope_id);
    if (lastOpened === null) return false;
    const hours = (Date.now() - lastOpened) / (1000 * 60 * 60);
    return hours >= STALE_HOURS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope_type, scope_id, unreadCount, hasRecentBroadcastWithReplies, cardEnabled, latestMessageId, dismissTick]);

  const summarize = useCallback(
    async (opts?: { force?: boolean; openSheet?: boolean }) => {
      if (!scope_id) return;
      setLoading(true);
      setError(null);
      if (opts?.openSheet) setSheetOpen(true);
      try {
        const { data, error } = await supabase.functions.invoke("summarize-chat", {
          body: { scope_type, scope_id, force: !!opts?.force },
        });
        if (error) {
          // FunctionsHttpError exposes context.response (a Response object) with the JSON error body.
          let code = "unknown";
          try {
            const ctx = (error as any).context;
            if (ctx?.response) {
              const j = await ctx.response.json();
              code = j?.error ?? code;
            }
          } catch { /* ignore */ }
          setError(code);
          return;
        }
        setResult(data as ChatSummaryResult);
      } catch (e: any) {
        setError(e?.message ?? "unknown");
      } finally {
        setLoading(false);
      }
    },
    [scope_type, scope_id],
  );

  const openSheet = useCallback(() => {
    setSheetOpen(true);
    if (!result && !loading) void summarize({ openSheet: true });
  }, [result, loading, summarize]);

  const dismissCard = useCallback(() => {
    if (!scope_id) return;
    setDismissedFor(scope_type, scope_id, latestMessageId ?? "dismissed");
    setDismissTick((n) => n + 1);
  }, [scope_type, scope_id, latestMessageId]);

  // Reset result if scope changes
  useEffect(() => {
    setResult(null);
    setError(null);
    setSheetOpen(false);
  }, [scope_type, scope_id]);

  return {
    eligible,
    loading,
    error,
    result,
    sheetOpen,
    setSheetOpen,
    summarize,
    openSheet,
    dismissCard,
  };
}
