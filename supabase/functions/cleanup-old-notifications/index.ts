import { requireServiceRoleAuth } from "../_shared/callerAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Daily cleanup to prevent unbounded table growth.
 *
 * Targets:
 * 1. notifications — read >30d, unread >90d
 * 2. push_notification_logs — all >60d
 * 3. sponsor_analytics — all >90d
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
 */

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TARGET = 200; // 200 * 500 = 100k rows per target per run
const MAX_RUNTIME_MS = 55_000;

type CleanupResult = {
  deleted: number;
  batches: number;
  truncated: boolean;
  error?: string;
};

async function batchDeleteByDate(
  supabase: any,
  table: string,
  cutoffDate: string,
  label: string,
  startedAt: number,
  extraFilters?: (query: any) => any,
): Promise<CleanupResult> {
  let totalDeleted = 0;
  let batches = 0;
  let truncated = false;

  while (true) {
    if (batches >= MAX_BATCHES_PER_TARGET) {
      truncated = true;
      console.log(`[CLEANUP] ${label}: hit batch cap (${MAX_BATCHES_PER_TARGET}), deferring rest to next run`);
      break;
    }
    if (Date.now() - startedAt > MAX_RUNTIME_MS) {
      truncated = true;
      console.log(`[CLEANUP] ${label}: hit runtime budget, deferring rest to next run`);
      break;
    }

    let selectQuery = supabase
      .from(table)
      .select('id')
      .lt('created_at', cutoffDate)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

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
    const { error: deleteError, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in('id', ids);

    if (deleteError) {
      console.error(`[CLEANUP] Delete error (${label}):`, deleteError);
      return { deleted: totalDeleted, batches, truncated: true, error: deleteError.message };
    }

    const removed = count ?? ids.length;
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


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const __authError = requireServiceRoleAuth(req, corsHeaders);
  if (__authError) return __authError;


  const startTime = Date.now();
  console.log('[CLEANUP] Starting daily data cleanup...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // 1. Notifications: read >30d  (column is `is_read`, NOT `read`)
    const readDeleted = await batchDeleteByDate(
      supabase, 'notifications', thirtyDaysAgo.toISOString(),
      'notifications read >30d', startTime,
      (q) => q.eq('is_read', true),
    );

    // 2. Notifications: unread >90d
    const unreadDeleted = await batchDeleteByDate(
      supabase, 'notifications', ninetyDaysAgo.toISOString(),
      'notifications unread >90d', startTime,
      (q) => q.eq('is_read', false),
    );

    // 3. Push notification logs >60d
    const pushLogsDeleted = await batchDeleteByDate(
      supabase, 'push_notification_logs', sixtyDaysAgo.toISOString(),
      'push_notification_logs >60d', startTime,
    );

    // 4. Sponsor analytics >90d
    const sponsorAnalyticsDeleted = await batchDeleteByDate(
      supabase, 'sponsor_analytics', ninetyDaysAgo.toISOString(),
      'sponsor_analytics >90d', startTime,
    );

    const results = {
      notifications_read: readDeleted,
      notifications_unread: unreadDeleted,
      push_notification_logs: pushLogsDeleted,
      sponsor_analytics: sponsorAnalyticsDeleted,
    };
    const totalDeleted = Object.values(results).reduce((sum, r) => sum + r.deleted, 0);
    const totalBatches = Object.values(results).reduce((sum, r) => sum + r.batches, 0);
    const moreWorkPending = Object.values(results).some((r) => r.truncated);
    const errors = Object.entries(results)
      .filter(([, r]) => r.error)
      .map(([k, r]) => `${k}: ${r.error}`);
    const elapsed = Date.now() - startTime;
    console.log(
      `[CLEANUP] Done: ${totalDeleted} rows in ${totalBatches} batches, ${elapsed}ms` +
        (moreWorkPending ? ' (more work pending — next run continues)' : ''),
    );

    return new Response(
      JSON.stringify({
        message: 'Daily cleanup complete',
        notifications_read_deleted: readDeleted.deleted,
        notifications_unread_deleted: unreadDeleted.deleted,
        push_logs_deleted: pushLogsDeleted.deleted,
        sponsor_analytics_deleted: sponsorAnalyticsDeleted.deleted,
        total_deleted: totalDeleted,
        total_batches: totalBatches,
        more_work_pending: moreWorkPending,
        per_target: results,
        errors,
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CLEANUP] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Cleanup failed', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});