import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sends a push notification to event attendees when a coach/admin posts or updates
 * the event note. Recipients = anyone who has RSVP'd (going / maybe / not_going)
 * to this event, excluding the author.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const __outboundBlocked = outboundBlockedResponse("notify-event-note");
  if (__outboundBlocked) return __outboundBlocked;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { eventId, isUpdate } = await req.json();
    if (!eventId) {
      return new Response(JSON.stringify({ error: 'eventId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

    // Verify caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: event } = await supabase
      .from('events')
      .select('id, title, coach_note, team_id, club_id')
      .eq('id', eventId)
      .single();

    if (!event || !event.coach_note?.trim()) {
      return new Response(JSON.stringify({ message: 'No note to notify about' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Recipients: anyone who RSVP'd (any status) — excluding the author
    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('user_id')
      .eq('event_id', eventId)
      .not('user_id', 'is', null);

    const recipientIds = [
      ...new Set((rsvps || []).map((r: any) => r.user_id as string)),
    ].filter((id) => id !== user.id);

    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ message: 'No recipients' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const verb = isUpdate ? 'updated the note' : 'posted a note';
    const message = `📝 ${event.title}: coach ${verb}`;
    const url = `/events/${eventId}`;

    // Insert notifications (skip_push so we send pushes ourselves)
    const rows = recipientIds.map((uid) => ({
      user_id: uid,
      type: 'event_note',
      message,
      related_id: eventId,
      skip_push: true,
    }));
    const { data: inserted } = await supabase
      .from('notifications')
      .insert(rows)
      .select('id, user_id');

    // Dispatch pushes in small groups with retry on transient failures
    const payloads = (inserted || []).map((n: any) => ({
      userId: n.user_id,
      title: 'Ignite',
      body: message,
      url,
      notificationId: n.id,
      tag: `event-note-${eventId}`,
      notificationType: 'event_note',
    }));
    const pushResult = await dispatchPushRequests(supabaseUrl, anonKey, payloads, {
      concurrency: 5, pauseMs: 150, logPrefix: '[NOTIFY-EVENT-NOTE]',
    });
    const sent = pushResult.sent;
    if (pushResult.failed > 0) {
      console.error(`[NOTIFY-EVENT-NOTE] push failures: ${pushResult.failed}/${payloads.length} for event_note:${eventId}`);
    }

    return new Response(JSON.stringify({ recipients: recipientIds.length, push_sent: sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[NOTIFY-EVENT-NOTE] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
