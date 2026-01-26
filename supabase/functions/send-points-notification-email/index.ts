import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PointsNotificationRequest {
  recipientUserId: string;
  pointsAwarded: number;
  reason?: string;
  totalPoints: number;
  clubName: string;
  clubLogoUrl?: string;
  rewardUnlocked?: boolean;
  rewardName?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      recipientUserId,
      pointsAwarded,
      reason,
      totalPoints,
      clubName,
      clubLogoUrl,
      rewardUnlocked,
      rewardName,
    }: PointsNotificationRequest = await req.json();

    console.log(`Processing points notification email for user ${recipientUserId}`);

    // Check if user is in any active club/team subscription
    const { data: activeRoles } = await supabase
      .from('user_roles')
      .select(`
        club_id,
        team_id,
        clubs:club_id(
          club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)
        ),
        teams:team_id(
          club_id,
          team_subscriptions(is_pro, is_pro_football, expires_at)
        )
      `)
      .eq('user_id', recipientUserId);

    const hasActiveSubscription = activeRoles?.some(role => {
      // Check club subscription
      const clubSubs = (role.clubs as any)?.club_subscriptions;
      if (clubSubs) {
        const sub = Array.isArray(clubSubs) ? clubSubs[0] : clubSubs;
        if (sub && (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override)) {
          if (!sub.expires_at || new Date(sub.expires_at) > new Date()) {
            return true;
          }
        }
      }
      // Check team subscription
      const teamSubs = (role.teams as any)?.team_subscriptions;
      if (teamSubs) {
        const sub = Array.isArray(teamSubs) ? teamSubs[0] : teamSubs;
        if (sub && (sub.is_pro || sub.is_pro_football)) {
          if (!sub.expires_at || new Date(sub.expires_at) > new Date()) {
            return true;
          }
        }
      }
      return false;
    }) ?? false;

    if (!hasActiveSubscription) {
      console.log('User is not in any active subscription, skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_active_subscription' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get recipient profile and email
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

    // Check email preferences for rewards
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_rewards_enabled')
      .eq('user_id', recipientUserId)
      .single();

    // Default to true if no preference set
    const emailEnabled = prefs?.email_rewards_enabled !== false;

    if (!emailEnabled) {
      console.log('User has disabled rewards emails, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'email_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Profile link
    const profileLink = '/profile';

    // Subject line
    const isPositive = pointsAwarded > 0;
    const subject = isPositive
      ? `You earned ${pointsAwarded} Ignite points!${rewardUnlocked ? ' 🎉' : ''}`
      : `Points Update from ${clubName}`;

    // Send email via send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipient.email,
        subject,
        template: 'points-awarded',
        templateData: {
          recipientName: recipient.display_name || 'Team Member',
          pointsAwarded,
          reason,
          totalPoints,
          clubName,
          profileLink,
          clubLogoUrl,
          rewardUnlocked,
          rewardName,
        },
      },
    });

    if (emailError) {
      console.error('Error sending points notification email:', emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Points notification email sent successfully to ${recipient.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in send-points-notification-email:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
