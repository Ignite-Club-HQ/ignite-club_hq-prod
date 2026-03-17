import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cleanup old notifications to prevent unbounded table growth.
 * 
 * Rules:
 * 1. Delete READ notifications older than 30 days
 * 2. Delete UNREAD notifications older than 90 days
 * 
 * Deletes in batches of 500 to avoid hitting Supabase row limits
 * and to prevent long-running transactions.
 * 
 * Intended to run daily via pg_cron at 3am UTC.
 */

async function batchDelete(
  supabase: ReturnType<typeof createClient>,
  readFilter: boolean,
  cutoffDate: string,
  label: string
): Promise<number> {
  const BATCH_SIZE = 500;
  let totalDeleted = 0;

  while (true) {
    // Select IDs first, then delete by ID — avoids the 1000-row default limit on delete
    const { data: rows, error: selectError } = await supabase
      .from('notifications')
      .select('id')
      .eq('read', readFilter)
      .lt('created_at', cutoffDate)
      .limit(BATCH_SIZE);

    if (selectError) {
      console.error(`[CLEANUP] Select error (${label}):`, selectError);
      break;
    }

    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: { id: string }) => r.id);
    const { error: deleteError, count } = await supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .in('id', ids);

    if (deleteError) {
      console.error(`[CLEANUP] Delete error (${label}):`, deleteError);
      break;
    }

    totalDeleted += count || ids.length;
    console.log(`[CLEANUP] ${label}: deleted batch of ${count || ids.length} (total: ${totalDeleted})`);

    // If we got fewer than BATCH_SIZE, we're done
    if (rows.length < BATCH_SIZE) break;
  }

  return totalDeleted;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[CLEANUP] Starting notification cleanup...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const readDeleted = await batchDelete(
      supabase, true, thirtyDaysAgo.toISOString(), 'read >30d'
    );

    const unreadDeleted = await batchDelete(
      supabase, false, ninetyDaysAgo.toISOString(), 'unread >90d'
    );

    const totalDeleted = readDeleted + unreadDeleted;
    const elapsed = Date.now() - startTime;
    console.log(`[CLEANUP] Done: ${totalDeleted} removed in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        message: 'Notification cleanup complete',
        read_deleted: readDeleted,
        unread_deleted: unreadDeleted,
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
