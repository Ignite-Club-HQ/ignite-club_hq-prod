import { requireServiceRoleOrAppAdmin } from "../_shared/callerAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cleanup stale push subscriptions
 * 
 * This function:
 * 1. Removes subscriptions that haven't been updated in 30+ days
 * 2. Removes duplicate subscriptions for the same user (keeps newest)
 * 3. Removes subscriptions with invalid/missing keys
 * 4. Removes subscriptions that have repeatedly failed delivery
 * 
 * Intended to be run on a daily cron schedule
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const __caller = await requireServiceRoleOrAppAdmin(req, corsHeaders);
  if ("response" in __caller) return __caller.response;


  console.log('[CLEANUP] Starting push subscription cleanup...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let totalRemoved = 0;
    const results: Record<string, number> = {};

    // 1. Remove subscriptions older than 30 days (likely stale)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: staleSubscriptions, error: staleError } = await supabase
      .from('push_subscriptions')
      .select('id')
      .lt('updated_at', thirtyDaysAgo.toISOString());

    if (staleError) {
      console.error('[CLEANUP] Error fetching stale subscriptions:', staleError);
    } else if (staleSubscriptions && staleSubscriptions.length > 0) {
      const staleIds = staleSubscriptions.map(s => s.id);
      const { error: deleteError } = await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', staleIds);

      if (!deleteError) {
        results.stale = staleIds.length;
        totalRemoved += staleIds.length;
        console.log(`[CLEANUP] Removed ${staleIds.length} stale subscriptions`);
      }
    }

    // 2. Remove subscriptions with missing keys (invalid)
    const { data: invalidSubscriptions, error: invalidError } = await supabase
      .from('push_subscriptions')
      .select('id')
      .or('p256dh.is.null,auth.is.null');

    if (invalidError) {
      console.error('[CLEANUP] Error fetching invalid subscriptions:', invalidError);
    } else if (invalidSubscriptions && invalidSubscriptions.length > 0) {
      const invalidIds = invalidSubscriptions.map(s => s.id);
      const { error: deleteError } = await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', invalidIds);

      if (!deleteError) {
        results.invalid = invalidIds.length;
        totalRemoved += invalidIds.length;
        console.log(`[CLEANUP] Removed ${invalidIds.length} invalid subscriptions`);
      }
    }

    // 3. Remove duplicate subscriptions per user (keep only the newest)
    // Find users with multiple subscriptions
    const { data: duplicateCheck, error: dupError } = await supabase
      .rpc('get_duplicate_push_subscriptions');

    if (dupError) {
      // RPC might not exist, try alternative approach
      console.log('[CLEANUP] RPC not available, using alternative approach for duplicates');
      
      const { data: allSubs, error: allError } = await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint, updated_at')
        .order('updated_at', { ascending: false });

      if (!allError && allSubs) {
        // Group by user_id and find duplicates
        const userSubs = new Map<string, typeof allSubs>();
        for (const sub of allSubs) {
          const existing = userSubs.get(sub.user_id) || [];
          existing.push(sub);
          userSubs.set(sub.user_id, existing);
        }

        const duplicateIds: string[] = [];
        for (const [userId, subs] of userSubs) {
          if (subs.length > 1) {
            // Keep the first (newest due to sort order), mark rest for deletion
            for (let i = 1; i < subs.length; i++) {
              // Also check if same endpoint - only delete exact duplicates
              if (subs[i].endpoint === subs[0].endpoint) {
                duplicateIds.push(subs[i].id);
              }
            }
          }
        }

        if (duplicateIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('push_subscriptions')
            .delete()
            .in('id', duplicateIds);

          if (!deleteError) {
            results.duplicates = duplicateIds.length;
            totalRemoved += duplicateIds.length;
            console.log(`[CLEANUP] Removed ${duplicateIds.length} duplicate subscriptions`);
          }
        }
      }
    }

    // 4. Remove subscriptions with 5+ failed deliveries in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: failedLogs, error: failedError } = await supabase
      .from('push_notification_logs')
      .select('endpoint')
      .eq('status', 'failed')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!failedError && failedLogs) {
      // Count failures per endpoint
      const failureCount = new Map<string, number>();
      for (const log of failedLogs) {
        const current = failureCount.get(log.endpoint) || 0;
        failureCount.set(log.endpoint, current + 1);
      }

      // Find endpoints with 5+ failures
      const problematicEndpoints: string[] = [];
      for (const [endpoint, count] of failureCount) {
        if (count >= 5) {
          problematicEndpoints.push(endpoint);
        }
      }

      if (problematicEndpoints.length > 0) {
        // Delete these subscriptions
        const { data: toDelete, error: fetchError } = await supabase
          .from('push_subscriptions')
          .select('id')
          .in('endpoint', problematicEndpoints);

        if (!fetchError && toDelete && toDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from('push_subscriptions')
            .delete()
            .in('id', toDelete.map(s => s.id));

          if (!deleteError) {
            results.failing = toDelete.length;
            totalRemoved += toDelete.length;
            console.log(`[CLEANUP] Removed ${toDelete.length} repeatedly failing subscriptions`);
          }
        }
      }
    }

    // 5. Clean up old logs (older than 30 days)
    const { error: logCleanError, count: logsDeleted } = await supabase
      .from('push_notification_logs')
      .delete({ count: 'exact' })
      .lt('created_at', thirtyDaysAgo.toISOString());

    if (!logCleanError && logsDeleted) {
      results.old_logs = logsDeleted;
      console.log(`[CLEANUP] Removed ${logsDeleted} old log entries`);
    }

    console.log(`[CLEANUP] Complete - removed ${totalRemoved} subscriptions total`);

    return new Response(
      JSON.stringify({
        message: 'Cleanup complete',
        subscriptions_removed: totalRemoved,
        details: results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CLEANUP] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Cleanup failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
