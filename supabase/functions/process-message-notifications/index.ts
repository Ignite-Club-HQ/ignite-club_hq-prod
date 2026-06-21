import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Module-scope env + client: created once per isolate, reused across warm invocations.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process message notifications asynchronously.
 * 
 * Called by lightweight DB triggers via net.http_post when a message is created.
 * Handles the fan-out: determines recipients, batch-inserts notifications with skip_push=true,
 * dispatches push notifications in controlled batches, and sends email notifications.
 * 
 * This replaces the old synchronous loops inside DB triggers that blocked
 * the message INSERT transaction.
 */

interface MessagePayload {
  messageType: 'team' | 'club' | 'group' | 'broadcast';
  messageId: string;
  authorId: string;
  messageText: string;
  imageUrl: string | null;
  teamId?: string;
  clubId?: string;
  groupId?: string;
  replyToId?: string | null;
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
    data?: Record<string, unknown>;
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
            data: n.data,
          }),
        }).then(r => { const ok = r.ok; r.body?.cancel(); return ok; })
      )
    );
    sent += results.filter(r => r.status === 'fulfilled' && r.value).length;
    failed += results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  }

  return { sent, failed };
}

// Build the push notification URL for a message type
function buildPushUrl(messageType: string, contextId: string | null, messageId: string): string {
  // Append ?message=<id> so the chat page scrolls to / highlights the new
  // message on open (handled by targetMessageId effect in each chat page).
  const q = messageId ? `?message=${encodeURIComponent(messageId)}` : '';
  switch (messageType) {
    case 'team': return contextId ? `/messages/${contextId}${q}` : '/messages';
    case 'club': return contextId ? `/messages/club/${contextId}${q}` : '/messages';
    case 'club_admin': return contextId ? `/messages/club-admin/${contextId}${q}` : '/messages';
    case 'dm':
    case 'direct': return contextId ? `/messages/dm/${contextId}${q}` : '/messages';
    case 'group': return contextId ? `/groups/${contextId}${q}` : '/messages';
    case 'broadcast': return `/messages/broadcast${q}`;
    default: return '/messages';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const payload: MessagePayload = await req.json();
    const { messageType, messageId, authorId, messageText, imageUrl, replyToId } = payload;
    
    console.log(`[NOTIFY] Processing ${messageType} message ${messageId} from ${authorId}`);

    const supabaseUrl = SUPABASE_URL;
    const supabase = supabaseAdmin;
    const anonKey = ANON_KEY;


    const hasImage = !!imageUrl;

    // Get sender name
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', authorId)
      .maybeSingle();
    let senderName = senderProfile?.display_name || 'Someone';

    // For team messages that are club/competition announcements, prefer the
    // announcement name (e.g. competition broadcasts post as "<Comp> (competition)").
    if (messageType === 'team') {
      const { data: tm } = await supabase
        .from('team_messages')
        .select('is_club_announcement, club_announcement_name')
        .eq('id', messageId)
        .maybeSingle();
      if (tm?.is_club_announcement && tm.club_announcement_name) {
        senderName = String(tm.club_announcement_name).replace(/\s*\(competition\)\s*$/i, '').trim() || senderName;
      }
    }

    // Determine recipients and context based on message type
    let recipientUserIds: string[] = [];
    let contextName = '';
    let contextId: string | null = null;
    let notificationType = '';
    let muteChatId = '';
    let muteChatType = '';

    if (messageType === 'team') {
      const teamId = payload.teamId!;
      contextId = teamId;
      muteChatId = teamId;
      muteChatType = 'team';
      notificationType = 'team_message';

      const { data: teamData } = await supabase
        .from('teams')
        .select('name')
        .eq('id', teamId)
        .maybeSingle();
      contextName = teamData?.name || 'team chat';

      const { data: members } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('team_id', teamId)
        .neq('user_id', authorId);

      const memberIds = [...new Set((members || []).map(m => m.user_id))];
      
      if (memberIds.length > 0) {
        const { data: muted } = await supabase
          .from('chat_mute_preferences')
          .select('user_id')
          .eq('chat_id', teamId)
          .eq('chat_type', 'team')
          .in('user_id', memberIds)
          .or('muted_until.is.null,muted_until.gt.' + new Date().toISOString());
        
        const mutedIds = new Set((muted || []).map(m => m.user_id));
        recipientUserIds = memberIds.filter(id => !mutedIds.has(id));
      }
    } else if (messageType === 'club') {
      const clubId = payload.clubId!;
      contextId = clubId;
      muteChatId = clubId;
      muteChatType = 'club';
      notificationType = 'club_message';

      const { data: clubData } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', clubId)
        .maybeSingle();
      contextName = clubData?.name || 'club chat';

      // Paginated fetch for club members
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      let allMemberIds: string[] = [];
      while (hasMore) {
        const { data: page } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('club_id', clubId)
          .neq('user_id', authorId)
          .range(offset, offset + PAGE_SIZE - 1);
        if (page && page.length > 0) {
          allMemberIds.push(...page.map(m => m.user_id));
          offset += PAGE_SIZE;
          hasMore = page.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
      const memberIds = [...new Set(allMemberIds)];
      
      if (memberIds.length > 0) {
        const { data: muted } = await supabase
          .from('chat_mute_preferences')
          .select('user_id')
          .eq('chat_id', clubId)
          .eq('chat_type', 'club')
          .in('user_id', memberIds)
          .or('muted_until.is.null,muted_until.gt.' + new Date().toISOString());
        
        const mutedIds = new Set((muted || []).map(m => m.user_id));
        recipientUserIds = memberIds.filter(id => !mutedIds.has(id));
      }
    } else if (messageType === 'group') {
      const groupId = payload.groupId!;
      contextId = groupId;
      muteChatId = groupId;
      muteChatType = 'group';
      notificationType = 'group_message';

      const { data: groupData } = await supabase
        .from('chat_groups')
        .select('name, club_id, team_id, mini_league_id, allowed_roles, membership_mode')
        .eq('id', groupId)
        .maybeSingle();

      if (!groupData) {
        return new Response(JSON.stringify({ error: 'Group not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      contextName = groupData.name || 'a group';

      let memberIds: string[] = [];

      const isPersonal = !groupData.club_id && !groupData.team_id && !groupData.mini_league_id;
      const isManual = groupData.membership_mode === 'manual';

      if (isPersonal || isManual) {
        // Personal groups OR scoped groups in MANUAL mode:
        // recipients are strictly the explicit group_members.
        // Club/app admin moderation access does NOT imply they want notifications.
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', groupId)
          .neq('user_id', authorId);
        memberIds = (members || []).map(m => m.user_id);
      } else if (groupData.mini_league_id) {
        // Mini-league chats route ONLY to league members:
        // - parents of players in this mini_league
        // - mini_league_admins explicitly added to this league
        // - league_admin role-holders for this club
        // Club-wide coaches/club_admins are intentionally excluded.
        const [parentMembers, leagueAdminMembers, roleAdminMembers] = await Promise.all([
          supabase
            .from('mini_league_players')
            .select('parent_user_id')
            .eq('mini_league_id', groupData.mini_league_id)
            .not('parent_user_id', 'is', null)
            .neq('parent_user_id', authorId),
          supabase
            .from('mini_league_admins')
            .select('user_id')
            .eq('mini_league_id', groupData.mini_league_id)
            .neq('user_id', authorId),
          supabase
            .from('user_roles')
            .select('user_id')
            .eq('club_id', groupData.club_id!)
            .eq('role', 'league_admin')
            .neq('user_id', authorId),
        ]);
        const parentIds = (parentMembers.data || []).map(m => m.parent_user_id);
        const leagueAdminIds = (leagueAdminMembers.data || []).map(m => m.user_id);
        const roleAdminIds = (roleAdminMembers.data || []).map(m => m.user_id);
        memberIds = [...new Set([...parentIds, ...leagueAdminIds, ...roleAdminIds])];
      } else {
        // Scoped group in ROLE mode (club or team).
        // Guard: in role mode, an empty allowed_roles means nobody has access —
        // never fan out to the entire club.
        if (!groupData.allowed_roles || groupData.allowed_roles.length === 0) {
          memberIds = [];
        } else {
          let query = supabase
            .from('user_roles')
            .select('user_id')
            .neq('user_id', authorId)
            .in('role', groupData.allowed_roles);

          if (groupData.team_id) {
            query = query.eq('team_id', groupData.team_id);
          } else if (groupData.club_id) {
            query = query.eq('club_id', groupData.club_id);
          }

          const { data: members } = await query;
          memberIds = [...new Set((members || []).map(m => m.user_id))];
        }
      }

      if (memberIds.length > 0) {
        const { data: muted } = await supabase
          .from('chat_mute_preferences')
          .select('user_id')
          .eq('chat_id', groupId)
          .eq('chat_type', 'group')
          .in('user_id', memberIds)
          .or('muted_until.is.null,muted_until.gt.' + new Date().toISOString());
        
        const mutedIds = new Set((muted || []).map(m => m.user_id));
        recipientUserIds = memberIds.filter(id => !mutedIds.has(id));
      }
    } else if (messageType === 'broadcast') {
      contextId = null;
      muteChatType = '';
      notificationType = 'broadcast';
      contextName = 'Ignite Support';

      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: page } = await supabase
          .from('profiles')
          .select('id')
          .neq('id', authorId)
          .range(offset, offset + PAGE_SIZE - 1);
        
        if (page && page.length > 0) {
          recipientUserIds.push(...page.map(p => p.id));
          offset += PAGE_SIZE;
          hasMore = page.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
    }

    // Pre-extract mentioned user IDs so we can exclude them from the regular
    // notification fan-out (they'll receive a more specific mention notification instead)
    const mentionRegex = /@\[[^\]]+\]\(([a-f0-9-]{36})\)/gi;
    const mentionedIds: string[] = [];
    let match;
    while ((match = mentionRegex.exec(messageText || '')) !== null) {
      if (match[1] && match[1] !== authorId) {
        mentionedIds.push(match[1]);
      }
    }
    const uniqueMentionedIds = new Set(mentionedIds);

    // Resolve the original author of the replied-to message up-front so we can
    // exclude them from the regular fan-out (otherwise they receive both a
    // "sent a message" notification AND a "replied to your message"
    // notification — i.e. duplicate push + duplicate inbox row).
    let originalAuthorId: string | null = null;
    if (replyToId) {
      const replyTable = messageType === 'team' ? 'team_messages'
        : messageType === 'club' ? 'club_messages'
        : messageType === 'group' ? 'group_messages'
        : 'broadcast_messages';
      const { data: originalMsg } = await supabase
        .from(replyTable)
        .select('author_id')
        .eq('id', replyToId)
        .maybeSingle();
      originalAuthorId = originalMsg?.author_id ?? null;
    }

    // Remove mentioned users AND reply-target author from the regular recipient
    // list so they each only receive their dedicated notification (mention /
    // reply) instead of two pushes for the same message.
    const filteredRecipientIds = recipientUserIds.filter(id =>
      !uniqueMentionedIds.has(id) && id !== originalAuthorId,
    );

    console.log(`[NOTIFY] ${filteredRecipientIds.length} recipients (${uniqueMentionedIds.size} mentioned separately, replyAuthor=${originalAuthorId ?? 'n/a'}) for ${messageType} message`);

    // Batch insert notifications with skip_push=true (in chunks of 500)
    const BATCH_SIZE = 500;
    let notificationsInserted = 0;
    const insertedNotificationIds: Array<{ userId: string; id: string }> = [];

    for (let i = 0; i < filteredRecipientIds.length; i += BATCH_SIZE) {
      const batch = filteredRecipientIds.slice(i, i + BATCH_SIZE);
      const notificationRows = batch.map(userId => ({
        user_id: userId,
        type: notificationType,
        message: messageType === 'broadcast'
          ? 'New announcement from Ignite Support'
          : `${senderName} sent a message in ${contextName}`,
        related_id: messageId,
        skip_push: true,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('notifications')
        .upsert(notificationRows, { onConflict: 'id', ignoreDuplicates: true })
        .select('id, user_id');

      if (insertError) {
        console.error(`[NOTIFY] Batch insert error (batch ${i / BATCH_SIZE}):`, insertError);
      } else {
        const rows = inserted || [];
        notificationsInserted += rows.length;
        insertedNotificationIds.push(...rows.map((r: any) => ({ userId: r.user_id, id: r.id })));
      }
    }

    // Handle reply notifications (single insert, skip_push=true, dispatch push individually)
    if (replyToId && originalAuthorId && originalAuthorId !== authorId) {
      let isMuted = false;
      if (muteChatId && muteChatType) {
        const { data: muteCheck } = await supabase
          .from('chat_mute_preferences')
          .select('id')
          .eq('user_id', originalAuthorId)
          .eq('chat_id', muteChatId)
          .eq('chat_type', muteChatType)
          .or('muted_until.is.null,muted_until.gt.' + new Date().toISOString())
          .maybeSingle();
        isMuted = !!muteCheck;
      }

      if (!isMuted) {
        const { data: replyNotif } = await supabase.from('notifications').insert({
          user_id: originalAuthorId,
          type: 'message_reply',
          message: `${senderName} replied to your message`,
          related_id: messageId,
          skip_push: true,
        }).select('id').single();

        if (replyNotif) {
          insertedNotificationIds.push({ userId: originalAuthorId, id: replyNotif.id });
        }
      }
    }

    // Handle @mentions (mentionedIds already extracted above)
    for (const mentionedId of [...uniqueMentionedIds]) {
      let isMuted = false;
      if (muteChatId && muteChatType) {
        const { data: muteCheck } = await supabase
          .from('chat_mute_preferences')
          .select('id')
          .eq('user_id', mentionedId)
          .eq('chat_id', muteChatId)
          .eq('chat_type', muteChatType)
          .or('muted_until.is.null,muted_until.gt.' + new Date().toISOString())
          .maybeSingle();
        isMuted = !!muteCheck;
      }

      if (!isMuted) {
        const mentionContext = messageType === 'broadcast' ? 'a broadcast' : contextName;
        const { data: mentionNotif } = await supabase.from('notifications').insert({
          user_id: mentionedId,
          type: 'message_mention',
          message: `${senderName} mentioned you in ${mentionContext}`,
          related_id: messageId,
          skip_push: true,
        }).select('id').single();

        if (mentionNotif) {
          insertedNotificationIds.push({ userId: mentionedId, id: mentionNotif.id });
        }
      }
    }

    // Dispatch push notifications in controlled batches (20 concurrent)
    const pushUrl = buildPushUrl(messageType, contextId, messageId);
    const pushPayloads = insertedNotificationIds.map(n => ({
      userId: n.userId,
      body: messageType === 'broadcast'
        ? 'New announcement from Ignite Support'
        : `${senderName} sent a message in ${contextName}`,
      url: pushUrl,
      notificationId: n.id,
      notificationType: notificationType,
      data: {
        notificationType,
        type: notificationType,
        message_id: messageId,
        related_id: messageId,
        author_id: authorId,
        text: (messageText || '').substring(0, 300),
        created_at: new Date().toISOString(),
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        ...(contextId ? { context_id: contextId } : {}),
        ...(payload.teamId ? { team_id: payload.teamId } : {}),
        ...(payload.clubId ? { club_id: payload.clubId } : {}),
        ...(payload.groupId ? { group_id: payload.groupId } : {}),
      },
    }));

    const pushResult = await dispatchPushBatch(supabaseUrl, anonKey, pushPayloads);

    // Send email notifications in batched concurrency (max 20 concurrent)
    const EMAIL_CONCURRENCY = 20;
    let emailsSent = 0;
    let emailsFailed = 0;

    for (let i = 0; i < recipientUserIds.length; i += EMAIL_CONCURRENCY) {
      const batch = recipientUserIds.slice(i, i + EMAIL_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(userId =>
          fetch(`${supabaseUrl}/functions/v1/send-message-notification-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              recipientUserId: userId,
              senderUserId: authorId,
              messageText: messageText || '',
              messageType: messageType === 'broadcast' ? 'broadcast' : messageType,
              contextId: contextId,
              contextName: contextName,
              messageId: messageId,
              hasImage: hasImage,
            }),
          }).then(r => { r.body?.cancel(); return r.ok; })
        )
      );
      emailsSent += results.filter(r => r.status === 'fulfilled' && r.value).length;
      emailsFailed += results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[NOTIFY] Done: ${notificationsInserted} notifs, push ${pushResult.sent}/${pushPayloads.length}, ${emailsSent} emails, ${mentionedIds.length} mentions in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        message: 'Notifications processed',
        recipients: recipientUserIds.length,
        notifications_inserted: notificationsInserted,
        push_sent: pushResult.sent,
        push_failed: pushResult.failed,
        emails_sent: emailsSent,
        mentions: mentionedIds.length,
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[NOTIFY] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process notifications', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
