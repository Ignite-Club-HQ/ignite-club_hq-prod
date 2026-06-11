import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process event notifications asynchronously.
 * 
 * Called by lightweight DB triggers via net.http_post when an event is created, cancelled, or updated.
 * Handles the fan-out: determines recipients, batch-inserts notifications with skip_push=true,
 * and dispatches push notifications in controlled batches (20 concurrent).
 */

interface ChangedField {
  field: string;
  old: string | null;
  new: string | null;
}

interface EventPayload {
  action: 'event_created' | 'event_cancelled' | 'event_updated';
  eventId: string;
  clubId: string;
  teamId: string | null;
  miniLeagueId: string | null;
  createdBy: string;
  title: string;
  changedFields?: ChangedField[];
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
            title: 'Ignite',
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

// Build a human-readable update message from changed fields
function buildUpdateMessage(title: string, changedFields: ChangedField[]): string {
  const fieldLabels: Record<string, string> = {
    date: 'date',
    start_time: 'kick-off time',
    meet_time: 'meet time',
    location: 'venue',
    address: 'address',
    title: 'title',
    opponent: 'opponent',
  };

  const changedNames = changedFields
    .map(f => fieldLabels[f.field] || f.field)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  if (changedNames.length === 1) {
    return `📅 ${title} updated: new ${changedNames[0]}`;
  }
  return `📅 ${title} updated: ${changedNames.slice(0, -1).join(', ')} & ${changedNames[changedNames.length - 1]} changed`;
}

// Resolve recipients for team/club/mini-league scoped events
async function resolveRecipients(
  supabase: any,
  eventId: string,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null,
  excludeUserId: string,
): Promise<string[]> {
  if (miniLeagueId) {
    // Mini-league events route ONLY to league members:
    // - parents/player-users in this mini_league
    // - mini_league_admins for this league
    // - league_admin role-holders for this club
    // Club-wide coaches/club_admins are intentionally excluded.
    const [playersResult, leagueAdminResult, roleAdminResult] = await Promise.all([
      supabase
        .from('mini_league_players')
        .select('parent_user_id')
        .eq('mini_league_id', miniLeagueId)
        .not('parent_user_id', 'is', null),
      supabase
        .from('mini_league_admins')
        .select('user_id')
        .eq('mini_league_id', miniLeagueId),
      supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'league_admin')
        .eq('club_id', clubId),
    ]);
    const parentIds = (playersResult.data || []).map((p: any) => p.parent_user_id);
    const leagueAdminIds = (leagueAdminResult.data || []).map((a: any) => a.user_id);
    const roleAdminIds = (roleAdminResult.data || []).map((a: any) => a.user_id);
    return [...new Set([...parentIds, ...leagueAdminIds, ...roleAdminIds])].filter(id => id !== excludeUserId);
  }

  // Paginate every branch deterministically. PostgREST has a per-request row cap
  // (project-configured, observed < 409 on this project) that silently truncates
  // un-ordered .range() queries — see Kings Cup fan-out incident where 8 club
  // members were silently dropped. Keep PAGE_SIZE well below any plausible cap.
  const PAGE_SIZE = 200;

  async function paginateUserIds(
    build: () => any,
  ): Promise<string[]> {
    let offset = 0;
    const ids: string[] = [];
    while (true) {
      const { data: page, error } = await build()
        .order('user_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.error('[EVENT-NOTIFY] Recipient pagination error:', error);
        break;
      }
      const rows = page || [];
      if (rows.length === 0) break;
      ids.push(...rows.map((m: any) => m.user_id));
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return ids;
  }

  if (teamId) {
    const ids = await paginateUserIds(() =>
      supabase
        .from('user_roles')
        .select('user_id')
        .eq('team_id', teamId)
        .neq('user_id', excludeUserId)
    );
    return [...new Set(ids)];
  }

  // Club-wide. If the event is role-restricted, only invite those roles plus club admins.
  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('restricted_to_roles')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) {
    console.error('[EVENT-NOTIFY] Restricted-role lookup error:', eventError);
  }
  const restrictedRoles = Array.isArray(eventRow?.restricted_to_roles)
    ? eventRow.restricted_to_roles
    : [];
  const rolesToInvite = restrictedRoles.length > 0
    ? [...new Set([...restrictedRoles, 'club_admin'])]
    : null;

  const ids = await paginateUserIds(() => {
    let query = supabase
      .from('user_roles')
      .select('user_id')
      .eq('club_id', clubId)
      .neq('user_id', excludeUserId);
    if (rolesToInvite) query = query.in('role', rolesToInvite);
    return query;
  });
  return [...new Set(ids)];
}

// Batch insert notifications and return inserted IDs
async function batchInsertNotifications(
  supabase: any,
  recipientUserIds: string[],
  notificationType: string,
  message: string,
  eventId: string,
): Promise<{ inserted: number; ids: Array<{ userId: string; id: string }> }> {
  const BATCH_SIZE = 500;
  let totalInserted = 0;
  const allIds: Array<{ userId: string; id: string }> = [];

  for (let i = 0; i < recipientUserIds.length; i += BATCH_SIZE) {
    const batch = recipientUserIds.slice(i, i + BATCH_SIZE);
    const rows = batch.map(userId => ({
      user_id: userId,
      type: notificationType,
      message,
      related_id: eventId,
      skip_push: true,
    }));

    const { data: inserted, error } = await supabase
      .from('notifications')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id, user_id');

    if (error) {
      console.error(`[EVENT-NOTIFY] Batch insert error:`, error);
    } else {
      const results = inserted || [];
      totalInserted += results.length;
      allIds.push(...results.map((r: any) => ({ userId: r.user_id, id: r.id })));
    }
  }

  return { inserted: totalInserted, ids: allIds };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const payload: EventPayload = await req.json();
    const { action, eventId, clubId, teamId, miniLeagueId, createdBy, title, changedFields } = payload;

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
      recipientUserIds = await resolveRecipients(supabase, eventId, clubId, teamId, miniLeagueId, createdBy);

    } else if (action === 'event_cancelled') {
      notificationType = 'event_cancelled';
      message = `Event cancelled: ${title} has been cancelled`;

      // Only notify users who have an RSVP for this event
      const { data: rsvps } = await supabase
        .from('rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .not('user_id', 'is', null);
      recipientUserIds = [...new Set((rsvps || []).map((r: any) => r.user_id))];

    } else if (action === 'event_updated') {
      notificationType = 'event_updated';

      if (!changedFields || changedFields.length === 0) {
        return new Response(
          JSON.stringify({ message: 'No tracked fields changed, skipping' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      message = buildUpdateMessage(title, changedFields);

      // Only notify users who have an RSVP for this event
      const { data: rsvps } = await supabase
        .from('rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .not('user_id', 'is', null);
      recipientUserIds = [...new Set((rsvps || []).map((r: any) => r.user_id))].filter(id => id !== createdBy);

    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[EVENT-NOTIFY] ${recipientUserIds.length} recipients for ${action}`);

    // Batch insert notifications
    const { inserted: notificationsInserted, ids: insertedNotificationIds } =
      await batchInsertNotifications(supabase, recipientUserIds, notificationType, message, eventId);

    console.log(`[EVENT-NOTIFY] Inserted ${notificationsInserted} notifications`);

    // Dispatch push notifications
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
