import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sends push notifications for upcoming events to a newly joined member.
 * Called by the notify_new_member_upcoming_events DB trigger.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, teamId, clubId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get the notifications we just inserted (event_invite for this user, recent)
    const { data: notifications } = await supabase
      .from('notifications')
      .select('id, message, related_id')
      .eq('user_id', userId)
      .eq('type', 'event_invite')
      .eq('skip_push', true)
      .gte('created_at', new Date(Date.now() - 60000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (!notifications || notifications.length === 0) {
      return new Response(JSON.stringify({ message: 'No notifications to push' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send a single summary push instead of one per event
    const count = notifications.length;
    const body = count === 1
      ? notifications[0].message
      : `You have ${count} upcoming events to check out`;
    const url = count === 1
      ? `/events/${notifications[0].related_id}`
      : '/events';

    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        userId,
        title: 'Ignite',
        body,
        url,
        tag: `new-member-events-${userId}`,
        notificationType: 'event_invite',
      }),
    });

    return new Response(JSON.stringify({ sent: 1, events: count }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[NOTIFY-NEW-MEMBER] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
