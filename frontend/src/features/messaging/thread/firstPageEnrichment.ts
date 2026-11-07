import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { capturePrivateProfileSession } from "@/live/privateProfileSession";
import { traceEnrichmentDone } from "@/lib/chatOpenTrace";

/** Return authorised text now; patch only optional fields on still-present rows later. */
export async function firstPageWithEnrichment<T extends { id: string }, D extends { messages: T[] }>(
  queryClient: QueryClient, key: QueryKey, conversationId: string,
  map: (ready: (rows: T[]) => void) => Promise<T[]>,
  data: (rows: T[]) => D, signal?: AbortSignal,
): Promise<D> {
  const assertSession = capturePrivateProfileSession();
  let first: T[] | undefined;
  const enriched = map(rows => { first = rows; });
  if (!first) return data(await enriched);
  const initial = data(first);
  // A task boundary lets React Query commit the core page before enrichment.
  void enriched.then(rows => new Promise<void>(resolve => setTimeout(() => {
    try {
      assertSession();
      if (signal?.aborted) return;
      const byId = new Map(rows.map(row => [row.id, row]));
      queryClient.setQueryData<D>(key, previous => {
        if (!previous) return previous;
        return { ...previous, messages: previous.messages.map(row => {
          const extra = byId.get(row.id);
          if (!extra) return row;
          const patch: Record<string, unknown> = {};
          for (const field of ["profiles", "author", "reactions", "reply_to"]) {
            if (field in extra) patch[field] = (extra as Record<string, unknown>)[field];
          }
          return { ...row, ...patch };
        }) };
      });
      traceEnrichmentDone(conversationId);
    } catch { /* logout/revocation retires all pending disclosure */ }
    finally { resolve(); }
  }, 0))).catch(() => { /* optional enrichment cannot fail the message page */ });
  return initial;
}