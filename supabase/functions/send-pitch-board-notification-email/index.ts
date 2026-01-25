import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PitchBoardEmailRequest {
  recipientUserId: string;
  teamId?: string;
  teamName: string;
  notificationType: 'pending_sub' | 'half_time' | 'full_time' | 'game_linked';
  notificationMessage: string;
  eventId?: string;
  playerOutName?: string;
  playerInName?: string;
  position?: string;
  elapsedMinutes?: number;
  currentHalf?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: PitchBoardEmailRequest = await req.json();
    const {
      recipientUserId,
      teamId,
      teamName,
      notificationType,
      notificationMessage,
      eventId,
      playerOutName,
      playerInName,
      position,
      elapsedMinutes,
      currentHalf,
    } = body;

    console.log(`[PITCH-EMAIL] Processing ${notificationType} email for user ${recipientUserId}`);

    // Check if user has email notifications enabled for pitch board
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('pitch_board_enabled, email_pitch_board_enabled')
      .eq('user_id', recipientUserId)
      .single();

    // Only send if push pitch board notifications are enabled
    if (prefs?.pitch_board_enabled === false) {
      console.log(`[PITCH-EMAIL] User ${recipientUserId} has pitch board notifications disabled`);
      return new Response(JSON.stringify({ skipped: true, reason: 'pitch_board_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only send if email pitch board notifications are enabled
    if (prefs?.email_pitch_board_enabled === false) {
      console.log(`[PITCH-EMAIL] User ${recipientUserId} has email pitch board notifications disabled`);
      return new Response(JSON.stringify({ skipped: true, reason: 'email_pitch_board_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get recipient's profile and email
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(recipientUserId);
    
    if (authError || !authUser?.user?.email) {
      console.error(`[PITCH-EMAIL] Could not get email for user ${recipientUserId}:`, authError?.message);
      return new Response(JSON.stringify({ error: 'User email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recipientEmail = authUser.user.email;

    // Get recipient's display name
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', recipientUserId)
      .single();

    const recipientName = profile?.display_name || 'Coach';

    // Build event link - for pending subs, link directly to pitch board with action param
    let eventLink = '/';
    if (notificationType === 'pending_sub') {
      // Direct link to team page with pitch board and pending sub action
      if (teamId) {
        eventLink = `/teams/${teamId}?tab=pitch-board&action=accept-sub`;
      } else if (eventId) {
        eventLink = `/events/${eventId}?action=accept-sub`;
      }
    } else if (eventId) {
      eventLink = `/events/${eventId}`;
    } else if (teamId) {
      eventLink = `/teams/${teamId}`;
    }

    // Get notification title based on type
    const getSubject = (type: string): string => {
      switch (type) {
        case 'pending_sub':
          return `⚡ Substitution Due - ${teamName}`;
        case 'half_time':
          return `⏸️ Half Time - ${teamName}`;
        case 'full_time':
          return `🏆 Full Time - ${teamName}`;
        case 'game_linked':
          return `🔗 Game Linked - ${teamName}`;
        default:
          return `🏟️ Pitch Board Update - ${teamName}`;
      }
    };

    // Call the send-email function with the pitch-board-notification template
    const { data: emailResult, error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipientEmail,
        subject: getSubject(notificationType),
        template: 'pitch-board-notification',
        templateData: {
          recipientName,
          teamName,
          notificationType,
          notificationMessage,
          eventLink: `https://igniteclubhq.app${eventLink}`,
          playerOutName,
          playerInName,
          position,
          elapsedMinutes,
          currentHalf,
        },
      },
    });

    if (emailError) {
      console.error(`[PITCH-EMAIL] Error sending email:`, emailError);
      return new Response(JSON.stringify({ error: emailError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[PITCH-EMAIL] Email sent successfully to ${recipientEmail} for ${notificationType}`);

    return new Response(JSON.stringify({ success: true, emailResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PITCH-EMAIL] Unexpected error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
