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
 * Intended to run daily via pg_cron at 3am UTC.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[CLEANUP-NOTIFICATIONS] Starting...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // 1. Delete read notifications older than 30 days
    const { count: readDeleted, error: readError } = await supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .eq('read', true)
      .lt('created_at', thirtyDaysAgo.toISOString());

    if (readError) {
      console.error('[CLEANUP-NOTIFICATIONS] Error deleting read notifications:', readError);
    } else {
      console.log(`[CLEANUP-NOTIFICATIONS] Deleted ${readDeleted} read notifications (>30 days)`);
    }

    // 2. Delete unread notifications older than 90 days
    const { count: unreadDeleted, error: unreadError } = await supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .eq('read', false)
      .lt('created_at', ninetyDaysAgo.toISOString());

    if (unreadError) {
      console.error('[CLEANUP-NOTIFICATIONS] Error deleting unread notifications:', unreadError);
    } else {
      console.log(`[CLEANUP-NOTIFICATIONS] Deleted ${unreadDeleted} unread notifications (>90 days)`);
    }

    const totalDeleted = (readDeleted || 0) + (unreadDeleted || 0);
    console.log(`[CLEANUP-NOTIFICATIONS] Complete — removed ${totalDeleted} total`);

    return new Response(
      JSON.stringify({
        message: 'Notification cleanup complete',
        read_deleted: readDeleted || 0,
        unread_deleted: unreadDeleted || 0,
        total_deleted: totalDeleted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[CLEANUP-NOTIFICATIONS] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Cleanup failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
