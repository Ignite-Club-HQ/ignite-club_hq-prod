import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RewardRedeemedRequest {
  recipientUserId: string;
  rewardName: string;
  pointsSpent: number;
  remainingPoints: number;
  clubName: string;
  rewardDescription?: string;
  sponsorName?: string;
  showQrCode?: boolean;
  clubLogoUrl?: string;
  rewardLogoUrl?: string;
  redeemedForChildName?: string;
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
      rewardName,
      pointsSpent,
      remainingPoints,
      clubName,
      rewardDescription,
      sponsorName,
      showQrCode,
      clubLogoUrl,
      rewardLogoUrl,
      redeemedForChildName,
    }: RewardRedeemedRequest = await req.json();

    console.log(`Processing reward redeemed email for user ${recipientUserId}`);

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

    // Send email via send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipient.email,
        subject: `🎁 You redeemed "${rewardName}" for ${pointsSpent} points!`,
        template: 'reward-redeemed',
        templateData: {
          recipientName: recipient.display_name || 'Team Member',
          rewardName,
          pointsSpent,
          remainingPoints,
          clubName,
          rewardDescription,
          sponsorName,
          showQrCode: showQrCode || false,
          profileLink,
          clubLogoUrl,
          rewardLogoUrl,
          redeemedForChildName,
        },
      },
    });

    if (emailError) {
      console.error('Error sending reward redeemed email:', emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Reward redeemed email sent successfully to ${recipient.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in send-reward-redeemed-email:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
