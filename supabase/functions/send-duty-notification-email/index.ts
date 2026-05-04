import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireServiceRoleAuth } from '../_shared/internal-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DutyNotificationRequest {
  recipientUserId: string;
  dutyName: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  teamName?: string;
  clubName: string;
  clubLogoUrl?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authErr = requireServiceRoleAuth(req, corsHeaders);
  if (authErr) return authErr;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      recipientUserId,
      dutyName,
      eventId,
      eventTitle,
      eventDate,
      eventTime,
      teamName,
      clubName,
      clubLogoUrl,
    }: DutyNotificationRequest = await req.json();

    console.log(`Processing duty notification email for user ${recipientUserId}`);

    // First check if user profile still exists (not deleted)
    const { data: profileExists } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', recipientUserId)
      .single();

    if (!profileExists) {
      console.log('User profile does not exist (deleted user), skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'user_deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user still has roles in any club/team (hasn't left)
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('club_id, team_id')
      .eq('user_id', recipientUserId);

    if (!userRoles || userRoles.length === 0) {
      console.log('User has no active roles (left all clubs/teams), skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_active_roles' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      console.log('User is not in any active subscription, skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_active_subscription' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get recipient profile and email preferences
    const { data: recipient } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', recipientUserId)
      .single();

    if (!recipient?.email) {
      console.log('Recipient has no email, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_email' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check email preferences - check if events email is enabled (duty is event-related)
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_events_enabled')
      .eq('user_id', recipientUserId)
      .single();

    // Default to true if no preference set
    const emailEnabled = prefs?.email_events_enabled !== false;

    if (!emailEnabled) {
      console.log('User has disabled event emails, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'email_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format event link
    const eventLink = `/events/${eventId}`;

    // Send email via send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipient.email,
        subject: `Duty Assignment: ${dutyName} for ${eventTitle}`,
        template: 'duty-assigned',
        templateData: {
          recipientName: recipient.display_name || 'Team Member',
          dutyName,
          eventTitle,
          eventDate,
          eventTime,
          teamName,
          clubName,
          eventLink,
          clubLogoUrl,
        },
      },
    });

    if (emailError) {
      console.error('Error sending duty notification email:', emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Duty notification email sent successfully to ${recipient.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in send-duty-notification-email:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
