import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: MessageNotificationPayload = await req.json();
    console.log("Processing message notification email:", payload.messageType, "for user:", payload.recipientUserId);

    // Get recipient's email and notification preferences
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(payload.recipientUserId);
    if (authError || !authUser?.user?.email) {
      console.log("Could not get recipient email:", authError?.message || "No email found");
      return new Response(JSON.stringify({ success: false, reason: "no_email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientEmail = authUser.user.email;

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

    // Check if user has muted this chat
    let chatId = payload.contextId;
    let chatType: string = payload.messageType;
    if (chatType === 'direct') {
      chatType = 'dm';
    }
    
    if (chatId) {
      const { data: mutePrefs } = await supabase
        .from('chat_mute_preferences')
        .select('id')
        .eq('user_id', payload.recipientUserId)
        .eq('chat_id', chatId)
        .eq('chat_type', chatType)
        .single();

      if (mutePrefs) {
        console.log("Chat is muted for user:", payload.recipientUserId);
        return new Response(JSON.stringify({ success: false, reason: "chat_muted" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
    let messageLink = 'https://igniteclubhq.app/messages';
    
    switch (payload.messageType) {
      case 'team':
        messageLink = `https://igniteclubhq.app/messages/team/${payload.contextId}`;
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
        messageLink = 'https://igniteclubhq.app/broadcast';
        break;
    }

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

    // Get club logo if applicable
    let clubLogoUrl: string | undefined;
    if (payload.messageType === 'team' && payload.contextId) {
      const { data: team } = await supabase
        .from('teams')
        .select('club_id, clubs(logo_url)')
        .eq('id', payload.contextId)
        .single();
      clubLogoUrl = (team?.clubs as any)?.logo_url;
    } else if (payload.messageType === 'club' && payload.contextId) {
      const { data: club } = await supabase
        .from('clubs')
        .select('logo_url')
        .eq('id', payload.contextId)
        .single();
      clubLogoUrl = club?.logo_url;
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
