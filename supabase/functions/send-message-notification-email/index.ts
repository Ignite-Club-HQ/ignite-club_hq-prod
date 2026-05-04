import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MessageNotificationPayload {
  recipientUserId: string;
  senderUserId: string;
  messageText: string;
  messageType: 'team' | 'club' | 'group' | 'direct' | 'broadcast';
  contextId?: string; // team_id, club_id, group_id, conversation_id
  contextName?: string;
  messageId: string;
  hasImage?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authErr = requireServiceRoleAuth(req, corsHeaders);
  if (authErr) return authErr;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: MessageNotificationPayload = await req.json();
    console.log("Processing message notification email:", payload.messageType, "for user:", payload.recipientUserId);

    // First check if user profile still exists (not deleted)
    const { data: profileExists } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', payload.recipientUserId)
      .single();

    if (!profileExists) {
      console.log('User profile does not exist (deleted user), skipping email');
      return new Response(JSON.stringify({ success: false, reason: "user_deleted" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user still has roles in any club/team (hasn't left)
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('club_id, team_id')
      .eq('user_id', payload.recipientUserId);

    if (!userRoles || userRoles.length === 0) {
      console.log('User has no active roles (left all clubs/teams), skipping email');
      return new Response(JSON.stringify({ success: false, reason: "no_active_roles" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is in any active club/team subscription
    let hasActiveSubscription = false;
    const now = new Date().toISOString();

    const clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))];
    const teamIds = [...new Set(userRoles.map(r => r.team_id).filter(Boolean))];

    if (clubIds.length > 0) {
      const { data: clubSubs } = await supabase
        .from('club_subscriptions')
        .select('club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at')
        .in('club_id', clubIds);

      hasActiveSubscription = clubSubs?.some(sub => 
        (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) &&
        (!sub.expires_at || sub.expires_at > now)
      ) ?? false;
    }

    if (!hasActiveSubscription && teamIds.length > 0) {
      const { data: teamSubs } = await supabase
        .from('team_subscriptions')
        .select('team_id, is_pro, is_pro_football, expires_at')
        .in('team_id', teamIds);

      hasActiveSubscription = teamSubs?.some(sub => 
        (sub.is_pro || sub.is_pro_football) && (!sub.expires_at || sub.expires_at > now)
      ) ?? false;
    }

    if (!hasActiveSubscription) {
      console.log("User is not in any active subscription, skipping email");
      return new Response(JSON.stringify({ success: false, reason: "no_active_subscription" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get recipient's email via batched RPC (avoids auth admin connection pool storm)
    const { data: emailRows, error: authError } = await supabase
      .rpc("get_user_emails", { user_ids: [payload.recipientUserId] });
    const recipientEmail = emailRows?.[0]?.email as string | undefined;
    if (authError || !recipientEmail) {
      console.log("Could not get recipient email:", authError?.message || "No email found");
      return new Response(JSON.stringify({ success: false, reason: "no_email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('messages_enabled, email_messages_enabled')
      .eq('user_id', payload.recipientUserId)
      .single();

    // Check if email notifications are enabled for messages
    // Default to true if no preferences exist
    const emailEnabled = prefs?.email_messages_enabled !== false;
    if (!emailEnabled) {
      console.log("Email notifications disabled for messages for user:", payload.recipientUserId);
      return new Response(JSON.stringify({ success: false, reason: "email_disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user has muted this chat (including timed mutes)
    let chatId = payload.contextId;
    let chatType: string = payload.messageType;
    if (chatType === 'direct') {
      chatType = 'dm';
    }
    
    if (chatId) {
      const { data: mutePrefs } = await supabase
        .from('chat_mute_preferences')
        .select('id, muted_until')
        .eq('user_id', payload.recipientUserId)
        .eq('chat_id', chatId)
        .eq('chat_type', chatType)
        .single();

      // Check if mute is active (indefinite or not yet expired)
      if (mutePrefs) {
        const isActiveMute = mutePrefs.muted_until === null || 
          new Date(mutePrefs.muted_until) > new Date();
        
        if (isActiveMute) {
          console.log("Chat is muted for user:", payload.recipientUserId, "until:", mutePrefs.muted_until || "indefinite");
          return new Response(JSON.stringify({ success: false, reason: "chat_muted" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Get sender's name
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', payload.senderUserId)
      .single();

    const senderName = senderProfile?.display_name || 'Someone';

    // Get recipient's name
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', payload.recipientUserId)
      .single();

    const recipientName = recipientProfile?.display_name || undefined;

    // Build the message link based on type
    // Routes: team = /messages/:teamId, club = /messages/club/:clubId, 
    // dm = /messages/dm/:conversationId, group = /groups/:groupId, broadcast = /messages/broadcast
    let messageLink = 'https://igniteclubhq.app/messages';
    
    console.log("Building message link for type:", payload.messageType, "contextId:", payload.contextId);
    
    switch (payload.messageType) {
      case 'team':
        // Team chat route is /messages/:teamId (not /messages/team/:id)
        messageLink = `https://igniteclubhq.app/messages/${payload.contextId}`;
        break;
      case 'club':
        messageLink = `https://igniteclubhq.app/messages/club/${payload.contextId}`;
        break;
      case 'group':
        messageLink = `https://igniteclubhq.app/groups/${payload.contextId}`;
        break;
      case 'direct':
        messageLink = `https://igniteclubhq.app/messages/dm/${payload.contextId}`;
        break;
      case 'broadcast':
        messageLink = 'https://igniteclubhq.app/messages/broadcast';
        break;
    }
    
    console.log("Generated message link:", messageLink);

    // Build email subject
    let subject = `New message from ${senderName}`;
    if (payload.contextName) {
      subject = `New message from ${senderName} in ${payload.contextName}`;
    }
    if (payload.messageType === 'direct') {
      subject = `${senderName} sent you a direct message`;
    }
    if (payload.messageType === 'broadcast') {
      subject = 'New announcement from Ignite Support';
    }

    // Get club logo if applicable - for teams, groups (including league chats), and club chats
    let clubLogoUrl: string | undefined;
    if (payload.messageType === 'team' && payload.contextId) {
      const { data: team } = await supabase
        .from('teams')
        .select('logo_url, club_id, clubs(logo_url)')
        .eq('id', payload.contextId)
        .single();
      // Prefer team logo, fall back to club logo
      clubLogoUrl = team?.logo_url || (team?.clubs as any)?.logo_url;
    } else if (payload.messageType === 'club' && payload.contextId) {
      const { data: club } = await supabase
        .from('clubs')
        .select('logo_url')
        .eq('id', payload.contextId)
        .single();
      clubLogoUrl = club?.logo_url;
    } else if (payload.messageType === 'group' && payload.contextId) {
      // For group chats (including league chats), get the logo from mini_league or club
      const { data: chatGroup } = await supabase
        .from('chat_groups')
        .select('mini_league_id, club_id, team_id')
        .eq('id', payload.contextId)
        .single();
      
      if (chatGroup) {
        // Check for mini league logo first
        if (chatGroup.mini_league_id) {
          const { data: miniLeague } = await supabase
            .from('mini_leagues')
            .select('logo_url, club_id, clubs(logo_url)')
            .eq('id', chatGroup.mini_league_id)
            .single();
          // Prefer league logo, fall back to club logo
          clubLogoUrl = miniLeague?.logo_url || (miniLeague?.clubs as any)?.logo_url;
        } else if (chatGroup.team_id) {
          // Team-based group chat
          const { data: team } = await supabase
            .from('teams')
            .select('logo_url, clubs(logo_url)')
            .eq('id', chatGroup.team_id)
            .single();
          clubLogoUrl = team?.logo_url || (team?.clubs as any)?.logo_url;
        } else if (chatGroup.club_id) {
          // Club-based group chat
          const { data: club } = await supabase
            .from('clubs')
            .select('logo_url')
            .eq('id', chatGroup.club_id)
            .single();
          clubLogoUrl = club?.logo_url;
        }
      }
    }

    // Call the send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipientEmail,
        subject,
        template: 'message-notification',
        templateData: {
          recipientName,
          senderName,
          messagePreview: payload.messageText || '',
          messageType: payload.messageType,
          contextName: payload.contextName,
          messageLink,
          clubLogoUrl,
          hasImage: payload.hasImage,
        },
      },
    });

    if (emailError) {
      console.error("Failed to send message notification email:", emailError);
      return new Response(JSON.stringify({ success: false, error: emailError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Message notification email sent successfully to:", recipientEmail);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-message-notification-email:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
