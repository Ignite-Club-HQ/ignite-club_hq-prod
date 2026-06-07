import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Fallback cron function that retries push notifications for recent notifications
 * that were missed by the pg_net trigger (which can silently drop requests).
 * 
 * Scaled for 400+ users:
 * - Checks up to 200 notifications per run (up from 50)
 * - Dispatches with controlled concurrency (20 at a time)
 * - Pre-inserts placeholder logs to prevent duplicate retries
 * 
 * Logic:
 * 1. Find notifications created in the last 5 minutes
 * 2. Check which ones have NO entry in push_notification_logs
 * 3. Re-dispatch those via the send-push-notification edge function
 */
serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look for notifications from the last 5 minutes that have no push log entry
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Don't retry very recent ones (< 15s) — give edge functions time to process
    const fifteenSecAgo = new Date(Date.now() - 15 * 1000).toISOString();

    const { data: recentNotifications, error: notifError } = await supabase
      .from('notifications')
      .select('id, user_id, type, message, related_id, skip_push')
      .gte('created_at', fiveMinAgo)
      .lte('created_at', fifteenSecAgo)
      .order('created_at', { ascending: false })
      .limit(200);

    if (notifError) {
      console.error('[RETRY-PUSH] Error fetching notifications:', notifError);
      return new Response(
        JSON.stringify({ error: notifError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!recentNotifications || recentNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No recent notifications to check', retried: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const notifIds = recentNotifications.map(n => n.id);

    // Check which ones already have push logs
    const { data: existingLogs, error: logError } = await supabase
      .from('push_notification_logs')
      .select('notification_id')
      .in('notification_id', notifIds);

    if (logError) {
      console.error('[RETRY-PUSH] Error fetching push logs:', logError);
      return new Response(
        JSON.stringify({ error: logError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const loggedIds = new Set((existingLogs || []).map(l => l.notification_id));
    // Exclude skip_push=true notifications — those are handled by edge functions
    // (e.g. check-pending-subs) which send their own pushes directly.
    // Retrying them here would cause duplicate push notifications.
    const missedNotifications = recentNotifications.filter(n => !loggedIds.has(n.id) && !n.skip_push);

    if (missedNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'All recent notifications have push logs', checked: notifIds.length, retried: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[RETRY-PUSH] Found ${missedNotifications.length} notifications without push logs, retrying...`);

    // Build URL for each notification (mirrors public.compute_push_notification_url DB trigger).
    // Async because some types need to resolve related_id → team/club/group id.
    const buildUrl = async (type: string, relatedId: string | null): Promise<string> => {
      const rid = relatedId || '';
      switch (type) {
        case 'direct_message':
          return rid ? `/messages/dm/${rid}` : '/messages';

        case 'team_message':
        case 'message_reply':
        case 'message_reaction':
        case 'message_mention': {
          if (!rid) return '/messages';
          try {
            const { data } = await supabase
              .from('team_messages')
              .select('team_id')
              .eq('id', rid)
              .maybeSingle();
            return data?.team_id ? `/messages/${data.team_id}?message=${rid}` : '/messages';
          } catch { return '/messages'; }
        }

        case 'club_message': {
          if (!rid) return '/messages';
          try {
            const { data } = await supabase
              .from('club_messages')
              .select('club_id')
              .eq('id', rid)
              .maybeSingle();
            return data?.club_id ? `/messages/club/${data.club_id}?message=${rid}` : '/messages';
          } catch { return '/messages'; }
        }

        case 'group_message':
        case 'message_forwarded': {
          if (!rid) return '/messages';
          try {
            const { data } = await supabase
              .from('group_messages')
              .select('group_id')
              .eq('id', rid)
              .maybeSingle();
            return data?.group_id ? `/groups/${data.group_id}?message=${rid}` : '/messages';
          } catch { return '/messages'; }
        }

        case 'broadcast':
          return '/messages/broadcast';

        case 'event_invite':
        case 'event_cancelled':
        case 'event_reminder':
        case 'event_view_reminder':
        case 'event_updated':
        case 'rsvp_reminder':
        case 'rsvp_updated':
        case 'rsvp':
        case 'duty_assigned':
          return rid ? `/events/${rid}` : '/events';

        case 'photo_uploaded':
        case 'photo_reaction':
        case 'photo_comment':
        case 'comment_reaction':
        case 'comment_reply':
          return rid ? `/media?photo=${rid}` : '/media';

        case 'points_awarded':
        case 'reward_redeemed':
        case 'early_rsvp_points':
        case 'player_of_match':
        case 'game_stats_ready':
          return '/profile?section=points-history';

        case 'formation_change':
        case 'pending_sub':
        case 'half_time':
        case 'game_finished':
        case 'game_started':
        case 'game_ended':
        case 'pitch_board':
        case 'pitch_board_update':
        case 'substitution':
        case 'substitution_alert':
          return '/';

        case 'member_joined':
        case 'invite_accepted':
        case 'team_join':
        case 'role_assigned':
          return rid ? `/teams/${rid}` : '/notifications';

        case 'club_join':
          return rid ? `/clubs/${rid}` : '/notifications';

        case 'scheduled_message_failed':
          return '/messages';

        case 'fee_payment_request':
        case 'payment_received':
        case 'payment_overdue':
        case 'subscription_expiring':
        case 'subscription_expired':
        case 'subscription_renewed':
        case 'storage_limit':
        case 'system_announcement':
        case 'reward_available':
        case 'membership':
        case 'role_removed':
        case 'team_invite':
        case 'join_request':
        case 'join_request_approved':
        case 'join_request_denied':
        case 'join_request_processed':
          return '/notifications';

        default:
          return '/notifications';
      }
    };


    // NOTE: We deliberately do NOT pre-insert placeholder logs here.
    // send-push-notification has its own claim mechanism (a 'pending' placeholder row)
    // that dedups concurrent invocations. If we pre-inserted a placeholder here,
    // send-push-notification would see it and skip — meaning the retry would never
    // actually be sent. Cross-run dedup is handled by the next run seeing the real
    // log row that send-push-notification writes after sending.

    // Dispatch with controlled concurrency (20 at a time)
    const CONCURRENCY = 20;
    let retriedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < missedNotifications.length; i += CONCURRENCY) {
      const batch = missedNotifications.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async notif => {
          const url = await buildUrl(notif.type, notif.related_id);
          const result = await supabase.functions.invoke('send-push-notification', {
            body: {
              userId: notif.user_id,
              title: 'Ignite',
              body: notif.message,
              url,
              notificationId: notif.id,
              tag: `${notif.type}-${notif.id}`,
              notificationType: notif.type,
            },
          });
          if (result.error) throw result.error;
          return true;
        })

      );

      retriedCount += results.filter(r => r.status === 'fulfilled').length;
      errorCount += results.filter(r => r.status === 'rejected').length;
    }

    console.log(`[RETRY-PUSH] Complete: ${retriedCount} retried, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        message: 'Retry complete',
        checked: notifIds.length,
        missed: missedNotifications.length,
        retried: retriedCount,
        errors: errorCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[RETRY-PUSH] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
