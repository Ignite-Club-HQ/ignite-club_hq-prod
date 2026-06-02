import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Notifies the original requester when a chat group join request has been
 * approved or rejected. Inserts a row in `notifications` and dispatches a push.
 *
 * Called by the frontend immediately after approve/reject succeeds. The caller
 * must be an existing member of the group (verified via the request row's
 * group). Safe to call repeatedly — deduped by tag/related_id on the push side.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { requestId, decision } = await req.json();
    if (!requestId || (decision !== 'approved' && decision !== 'rejected')) {
      return new Response(JSON.stringify({ error: 'requestId and decision (approved|rejected) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

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

    const { data: reqRow, error: reqErr } = await supabase
      .from('chat_group_join_requests')
      .select('id, user_id, group_id, status')
      .eq('id', requestId)
      .maybeSingle();
    if (reqErr || !reqRow) {
      return new Response(JSON.stringify({ error: 'Request not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is/was a group member (cheap auth — RPC already validated)
    const { data: isMember } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', reqRow.group_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!isMember) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: group } = await supabase
      .from('chat_groups')
      .select('id, name')
      .eq('id', reqRow.group_id)
      .maybeSingle();

    const groupName = group?.name || 'the group';
    const approved = decision === 'approved';
    const type = approved ? 'join_request_approved' : 'join_request_denied';
    const message = approved
      ? `✅ Your request to join ${groupName} was approved`
      : `❌ Your request to join ${groupName} was not approved`;
    const url = approved ? `/groups/${reqRow.group_id}` : '/messages';

    const { data: inserted } = await supabase
      .from('notifications')
      .insert({
        user_id: reqRow.user_id,
        type,
        message,
        related_id: reqRow.group_id,
        skip_push: true,
      })
      .select('id')
      .single();

    const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({
        userId: reqRow.user_id,
        title: 'Ignite',
        body: message,
        url,
        notificationId: inserted?.id,
        tag: `join-req-${requestId}`,
        notificationType: type,
      }),
    });
    pushRes.body?.cancel();

    return new Response(JSON.stringify({ ok: true, push_sent: pushRes.ok }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[NOTIFY-JOIN-REQUEST-DECISION] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
