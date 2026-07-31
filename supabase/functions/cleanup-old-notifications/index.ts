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
 * Deletes in batches of 500 to avoid row limits and long transactions.
 * Runs daily via pg_cron at 3am UTC.
 */

async function batchDeleteByDate(
  supabase: any,
  table: string,
  cutoffDate: string,
  label: string,
  extraFilters?: (query: any) => any,
): Promise<number> {
  const BATCH_SIZE = 2000;
  let totalDeleted = 0;

  while (true) {
    let selectQuery = supabase
      .from(table)
      .select('id')
      .lt('created_at', cutoffDate)
      .limit(BATCH_SIZE);

    if (extraFilters) {
      selectQuery = extraFilters(selectQuery);
    }

    const { data: rows, error: selectError } = await selectQuery;

    if (selectError) {
      console.error(`[CLEANUP] Select error (${label}):`, selectError);
      break;
    }

    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: { id: string }) => r.id);
    const { error: deleteError, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in('id', ids);

    if (deleteError) {
      console.error(`[CLEANUP] Delete error (${label}):`, deleteError);
      break;
    }

    totalDeleted += count || ids.length;
    console.log(`[CLEANUP] ${label}: batch ${count || ids.length} (total: ${totalDeleted})`);

    if (rows.length < BATCH_SIZE) break;
  }

  return totalDeleted;
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

    // 1. Notifications: read >30d
    const readDeleted = await batchDeleteByDate(
      supabase, 'notifications', thirtyDaysAgo.toISOString(),
      'notifications read >30d',
      (q) => q.eq('read', true),
    );

    // 2. Notifications: unread >90d
    const unreadDeleted = await batchDeleteByDate(
      supabase, 'notifications', ninetyDaysAgo.toISOString(),
      'notifications unread >90d',
      (q) => q.eq('read', false),
    );

    // 3. Push notification logs >60d
    const pushLogsDeleted = await batchDeleteByDate(
      supabase, 'push_notification_logs', sixtyDaysAgo.toISOString(),
      'push_notification_logs >60d',
    );

    // 4. Sponsor analytics >90d
    const sponsorAnalyticsDeleted = await batchDeleteByDate(
      supabase, 'sponsor_analytics', ninetyDaysAgo.toISOString(),
      'sponsor_analytics >90d',
    );

    const totalDeleted = readDeleted + unreadDeleted + pushLogsDeleted + sponsorAnalyticsDeleted;
    const elapsed = Date.now() - startTime;
    console.log(`[CLEANUP] Done: ${totalDeleted} total removed in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        message: 'Daily cleanup complete',
        notifications_read_deleted: readDeleted,
        notifications_unread_deleted: unreadDeleted,
        push_logs_deleted: pushLogsDeleted,
        sponsor_analytics_deleted: sponsorAnalyticsDeleted,
        total_deleted: totalDeleted,
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