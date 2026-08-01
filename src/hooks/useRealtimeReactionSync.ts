import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  recordRealtimeReaction,
  recordRealtimeReactionDelete,
  removeReactionFromMessages,
  upsertReactionInMessages,
  type ReconcilableReaction,
} from "@/lib/chatReactionReconciliation";

type ReactionCarrier = { id: string; reactions?: ReconcilableReaction[] | null };

/**
 * Applies realtime `message_reactions` events to EVERY active message store of
 * a chat page (React Query cache + rendered `localMessages`) using the same
 * pure, idempotent helpers, and records the delta so a query response already
 * in flight cannot overwrite the newer reaction when it lands.
 *
 * Every chat type that keeps the dual-store pattern must route its reaction
 * INSERT/UPDATE/DELETE handlers through this hook — updating only the query
 * cache makes reactions invisible whenever the list renders from
 * `localMessages`.
 */
export function useRealtimeReactionSync<T extends ReactionCarrier>(opts: {
  scopeKey: string;
  queryKey: readonly unknown[];
  setLocalMessages: Dispatch<SetStateAction<T[] | undefined>>;
  /** Read the message array out of the cached query payload. */
  readMessages?: (old: any) => T[];
  /** Write the message array back into the cached query payload. */
  writeMessages?: (old: any, next: T[]) => any;
}) {
  const { scopeKey, queryKey, setLocalMessages, readMessages, writeMessages } = opts;
  const queryClient = useQueryClient();

  const keyToken = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const read = readMessages ?? ((old: any) => (old?.messages || []) as T[]);
  const write = writeMessages ?? ((old: any, next: T[]) => ({ ...(old || {}), messages: next }));

  const mutateStores = useCallback(
    (mutator: (messages: T[]) => T[]) => {
      const key = JSON.parse(keyToken) as unknown[];
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return old;
        return write(old, mutator(read(old)));
      });
      setLocalMessages((prev) => (prev ? mutator(prev) : prev));
    },
    // `read`/`write` are recreated each render but are pure by contract; the
    // identity churn is intentionally excluded so the returned callbacks stay
    // stable for realtime effect dependency arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, keyToken, setLocalMessages],
  );

  const applyRealtimeReaction = useCallback(
    (messageId: string, raw: { id: string; user_id: string; reaction_type: string }) => {
      if (!messageId || !raw?.id) return;
      const reaction: ReconcilableReaction = {
        id: raw.id,
        user_id: raw.user_id,
        reaction_type: raw.reaction_type,
      };
      recordRealtimeReaction(scopeKey, messageId, reaction);
      mutateStores((messages) => upsertReactionInMessages(messages, messageId, reaction));
    },
    [scopeKey, mutateStores],
  );

  const applyRealtimeReactionDelete = useCallback(
    (messageId: string | null | undefined, reactionId: string) => {
      if (!reactionId) return;
      recordRealtimeReactionDelete(scopeKey, messageId, reactionId);
      mutateStores((messages) => removeReactionFromMessages(messages, reactionId));
    },
    [scopeKey, mutateStores],
  );

  return { applyRealtimeReaction, applyRealtimeReactionDelete };
}
