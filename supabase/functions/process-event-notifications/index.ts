import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process event notifications asynchronously.
 * 
 * Called by lightweight DB triggers via net.http_post when an event is created or cancelled.
 * Handles the fan-out: determines recipients, batch-inserts notifications with skip_push=true,
 * and dispatches push notifications in controlled batches (20 concurrent).
 * 
 * This replaces the old synchronous notify_team_members/notify_club_members calls
 * that blocked the event INSERT/UPDATE transaction and created N per-row push dispatches.
 */

interface EventPayload {
  action: 'event_created' | 'event_cancelled';
  eventId: string;
  clubId: string;
  teamId: string | null;
  miniLeagueId: string | null;
  createdBy: string;
  title: string;
}

// Dispatch push notifications with controlled concurrency
async function dispatchPushBatch(
  supabaseUrl: string,
  anonKey: string,
  notifications: Array<{
    userId: string;
    body: string;
    url: string;
    notificationId?: string;
    notificationType: string;
  }>,
  concurrency: number = 20
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < notifications.length; i += concurrency) {
    const batch = notifications.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(n =>
        fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            userId: n.userId,
            title: 'Ignite Club HQ',
            body: n.body,
            url: n.url,
            notificationId: n.notificationId,
            tag: `${n.notificationType}-${n.notificationId || Date.now()}`,
            notificationType: n.notificationType,
          }),
        }).then(r => { const ok = r.ok; r.body?.cancel(); return ok; })
      )
    );
    sent += results.filter(r => r.status === 'fulfilled' && r.value).length;
    failed += results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  }

  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const payload: EventPayload = await req.json();
    const { action, eventId, clubId, teamId, miniLeagueId, createdBy, title } = payload;

    console.log(`[EVENT-NOTIFY] Processing ${action} for event ${eventId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

    let recipientUserIds: string[] = [];
    let notificationType: string;
    let message: string;
    const notificationUrl = `/events/${eventId}`;

    if (action === 'event_created') {
      notificationType = 'event_invite';
      message = `You've been invited to: ${title}`;

      if (miniLeagueId) {
        // Mini-league event: notify parents with players in the league + league admins/coaches
        const [parentResult, adminResult] = await Promise.all([
          supabase
            .from('mini_league_players')
            .select('parent_user_id')
            .eq('mini_league_id', miniLeagueId)
            .not('parent_user_id', 'is', null),
          supabase
            .from('user_roles')
            .select('user_id')
            .in('role', ['league_admin', 'coach', 'club_admin'])
            .eq('club_id', clubId),
        ]);
        const parentIds = (parentResult.data || []).map(p => p.parent_user_id);
        const adminIds = (adminResult.data || []).map(a => a.user_id);
        recipientUserIds = [...new Set([...parentIds, ...adminIds])].filter(id => id !== createdBy);
      } else if (teamId) {
        // Team event - notify team members
        const { data: members } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', teamId)
          .neq('user_id', createdBy);
        recipientUserIds = [...new Set((members || []).map(m => m.user_id))];
      } else {
        // Club event - notify club members (paginated)
        const PAGE_SIZE = 1000;
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: page } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('club_id', clubId)
            .neq('user_id', createdBy)
            .range(offset, offset + PAGE_SIZE - 1);
          if (page && page.length > 0) {
            recipientUserIds.push(...page.map(m => m.user_id));
            offset += PAGE_SIZE;
            hasMore = page.length === PAGE_SIZE;
          } else {
            hasMore = false;
          }
        }
        recipientUserIds = [...new Set(recipientUserIds)];
      }
    } else if (action === 'event_cancelled') {
      notificationType = 'event_cancelled';
      message = `Event cancelled: ${title} has been cancelled`;

      // First: Get users who RSVP'd
      const { data: rsvps } = await supabase
        .from('rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .not('user_id', 'is', null);
      const rsvpUserIds = new Set((rsvps || []).map(r => r.user_id));

      // Then: Get remaining team/club/mini-league members NOT already in RSVP list
      let additionalIds: string[] = [];

      if (miniLeagueId) {
        // Mini-league event: parents + league admins/coaches
        const [parentResult, adminResult] = await Promise.all([
          supabase
            .from('mini_league_players')
            .select('parent_user_id')
            .eq('mini_league_id', miniLeagueId)
            .not('parent_user_id', 'is', null),
          supabase
            .from('user_roles')
            .select('user_id')
            .in('role', ['league_admin', 'coach', 'club_admin'])
            .eq('club_id', clubId),
        ]);
        const parentIds = (parentResult.data || []).map(p => p.parent_user_id);
        const adminIds = (adminResult.data || []).map(a => a.user_id);
        additionalIds = [...new Set([...parentIds, ...adminIds])];
      } else if (teamId) {
        const { data: members } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', teamId)
          .not('user_id', 'is', null);
        additionalIds = (members || []).map(m => m.user_id);
      } else {
        // Club event - paginated
        const PAGE_SIZE = 1000;
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: page } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('club_id', clubId)
            .not('user_id', 'is', null)
            .range(offset, offset + PAGE_SIZE - 1);
          if (page && page.length > 0) {
            additionalIds.push(...page.map(m => m.user_id));
            offset += PAGE_SIZE;
            hasMore = page.length === PAGE_SIZE;
          } else {
            hasMore = false;
          }
        }
      }

      // Merge RSVP'd users + additional members (deduplicated)
      recipientUserIds = [...new Set([...rsvpUserIds, ...additionalIds])];
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[EVENT-NOTIFY] ${recipientUserIds.length} recipients for ${action}`);

    // Batch insert notifications with skip_push=true
    const BATCH_SIZE = 500;
    let notificationsInserted = 0;
    const insertedNotificationIds: Array<{ userId: string; id: string }> = [];

    for (let i = 0; i < recipientUserIds.length; i += BATCH_SIZE) {
      const batch = recipientUserIds.slice(i, i + BATCH_SIZE);
      const notificationRows = batch.map(userId => ({
        user_id: userId,
        type: notificationType,
        message,
        related_id: eventId,
        skip_push: true,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('notifications')
        .upsert(notificationRows, { onConflict: 'id', ignoreDuplicates: true })
        .select('id, user_id');

      if (insertError) {
        console.error(`[EVENT-NOTIFY] Batch insert error:`, insertError);
      } else {
        const rows = inserted || [];
        notificationsInserted += rows.length;
        insertedNotificationIds.push(...rows.map((r: any) => ({ userId: r.user_id, id: r.id })));
      }
    }

    console.log(`[EVENT-NOTIFY] Inserted ${notificationsInserted} notifications`);

    // Dispatch push notifications in controlled batches
    const pushPayloads = insertedNotificationIds.map(n => ({
      userId: n.userId,
      body: message,
      url: notificationUrl,
      notificationId: n.id,
      notificationType,
    }));

    const pushResult = await dispatchPushBatch(supabaseUrl, anonKey, pushPayloads);

    const elapsed = Date.now() - startTime;
    console.log(`[EVENT-NOTIFY] Done: ${notificationsInserted} notifications, push ${pushResult.sent}/${pushPayloads.length} in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        message: 'Event notifications processed',
        action,
        recipients: recipientUserIds.length,
        notifications_inserted: notificationsInserted,
        push_sent: pushResult.sent,
        push_failed: pushResult.failed,
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[EVENT-NOTIFY] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process event notifications', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
