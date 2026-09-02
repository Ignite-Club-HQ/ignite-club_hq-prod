/**
 * Bounded, rerunnable batch deletion used by the daily cleanup function.
 *
 * Batching notes (fixed 2026-09-02):
 * - PostgREST caps a SELECT at 1000 rows by default, so the old BATCH_SIZE of
 *   2000 meant `rows.length < BATCH_SIZE` was true on the very first pass and
 *   the loop exited after a single batch. BATCH_SIZE is now 500, safely under
 *   the server cap, and termination no longer relies on a short read: the loop
 *   ends only when a batch returns zero rows, a delete fails, or the safety
 *   caps below are hit.
 * - Each batch is its own statement, so there is never one giant transaction.
 * - Bounded work per invocation (MAX_BATCHES_PER_TARGET / MAX_RUNTIME_MS)
 *   guarantees termination and keeps the function inside its wall-clock budget.
 * - Deletes are keyed by id with the same cutoff predicate re-applied, so
 *   repeated runs are idempotent: rows already gone simply aren't selected.
 *
 * Extracted from index.ts so the loop can be unit tested without booting a
 * Deno HTTP server.
 */

export const BATCH_SIZE = 500;
export const MAX_BATCHES_PER_TARGET = 200; // 200 * 500 = 100k rows per target per run
export const MAX_RUNTIME_MS = 55_000;
/**
 * `.in('id', ids)` is serialised into the request URL, so a large id list makes
 * the request line exceed the gateway limit and PostgREST answers 400 "Bad
 * Request" (observed live in DEV with the previous 2000-id deletes). Each batch
 * is therefore deleted in sub-chunks small enough to keep the URL well inside
 * that limit: 100 uuids is roughly 4 KB.
 */
export const DELETE_CHUNK_SIZE = 100;


export type CleanupResult = {
  deleted: number;
  batches: number;
  truncated: boolean;
  error?: string;
};

export type BatchDeleteOptions = {
  batchSize?: number;
  maxBatches?: number;
  maxRuntimeMs?: number;
  now?: () => number;
};

export async function batchDeleteByDate(
  supabase: any,
  table: string,
  cutoffDate: string,
  label: string,
  startedAt: number,
  extraFilters?: (query: any) => any,
  options: BatchDeleteOptions = {},
): Promise<CleanupResult> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_TARGET;
  const maxRuntimeMs = options.maxRuntimeMs ?? MAX_RUNTIME_MS;
  const now = options.now ?? (() => Date.now());

  let totalDeleted = 0;
  let batches = 0;
  let truncated = false;

  while (true) {
    if (batches >= maxBatches) {
      truncated = true;
      console.log(`[CLEANUP] ${label}: hit batch cap (${maxBatches}), deferring rest to next run`);
      break;
    }
    if (now() - startedAt > maxRuntimeMs) {
      truncated = true;
      console.log(`[CLEANUP] ${label}: hit runtime budget, deferring rest to next run`);
      break;
    }

    let selectQuery = supabase
      .from(table)
      .select('id')
      .lt('created_at', cutoffDate)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (extraFilters) {
      selectQuery = extraFilters(selectQuery);
    }

    const { data: rows, error: selectError } = await selectQuery;

    if (selectError) {
      console.error(`[CLEANUP] Select error (${label}):`, selectError);
      return { deleted: totalDeleted, batches, truncated: true, error: selectError.message };
    }

    // Zero rows is the ONLY clean termination condition — a short batch can
    // still be followed by more eligible rows once server-side caps apply.
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: { id: string }) => r.id);
    const chunkSize = options.deleteChunkSize ?? DELETE_CHUNK_SIZE;
    let removed = 0;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error: deleteError, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .in('id', chunk);

      if (deleteError) {
        console.error(`[CLEANUP] Delete error (${label}):`, deleteError);
        return {
          deleted: totalDeleted + removed,
          batches,
          truncated: true,
          error: deleteError.message,
        };
      }

      removed += count ?? chunk.length;
    }


    batches += 1;
    totalDeleted += removed;
    console.log(`[CLEANUP] ${label}: batch ${batches} removed ${removed} (total: ${totalDeleted})`);

    // Defensive: if a batch deleted nothing at all, the rows are no longer
    // reachable (RLS/permissions or a concurrent run) — stop instead of looping.
    if (removed === 0) {
      console.warn(`[CLEANUP] ${label}: batch deleted 0 rows, stopping to avoid an infinite loop`);
      truncated = true;
      break;
    }
  }

  return { deleted: totalDeleted, batches, truncated };
}
