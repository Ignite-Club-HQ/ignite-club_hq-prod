import { requireServiceRoleAuth } from "../_shared/callerAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchDeleteByDate } from "./batchDelete.ts";

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
 * The bounded batching loop lives in ./batchDelete.ts (unit tested).
 */



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