import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate cron secret for security
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = Deno.env.get('CRON_SECRET');
  
  if (!cronSecret || cronSecret !== expectedSecret) {
    console.error('Unauthorized: Invalid or missing cron secret');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Processing duty points for games ended 24+ hours ago...');

    // Find duties that:
    // 1. Are assigned to someone
    // 2. Haven't had points awarded yet
    // 3. Belong to events that ended 24+ hours ago
    // 4. Belong to Pro clubs (is_pro = true) or Pro Football teams
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: eligibleDuties, error: dutiesError } = await supabase
      .from('duties')
      .select(`
        id,
        assigned_to,
        event_id,
        events!inner (
          id,
          event_date,
          club_id,
          team_id,
          clubs!inner (
            id,
            name,
            logo_url,
            is_pro
          )
        )
      `)
      .not('assigned_to', 'is', null)
      .eq('points_awarded', false)
      .lt('events.event_date', twentyFourHoursAgo);

    if (dutiesError) {
      console.error('Error fetching eligible duties:', dutiesError);
      throw dutiesError;
    }

    console.log(`Found ${eligibleDuties?.length || 0} eligible duties to process`);

    let processedCount = 0;
    let pointsAwarded = 0;
    let emailsSent = 0;

    for (const duty of eligibleDuties || []) {
      const event = duty.events as any;
      const club = event?.clubs;
      
      // Check if club is Pro (required for points)
      // Also check team subscription for Pro Football
      let canAwardPoints = club?.is_pro === true;
      
      if (!canAwardPoints && event?.team_id) {
        const { data: teamSub } = await supabase
          .from('team_subscriptions')
          .select('is_pro, is_pro_football')
          .eq('team_id', event.team_id)
          .maybeSingle();
        
        canAwardPoints = teamSub?.is_pro === true || teamSub?.is_pro_football === true;
      }

      if (!canAwardPoints) {
        // Mark as processed but don't award points (free tier)
        await supabase
          .from('duties')
          .update({ points_awarded: true })
          .eq('id', duty.id);
        processedCount++;
        console.log(`Duty ${duty.id}: Marked as processed (free tier, no points)`);
        continue;
      }

      // Get current profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('ignite_points, has_sausage_reward')
        .eq('id', duty.assigned_to)
        .single();

      if (!profile) {
        console.log(`Duty ${duty.id}: User ${duty.assigned_to} not found, skipping`);
        continue;
      }

      const newPoints = (profile.ignite_points || 0) + 10;
      const updateData: any = { ignite_points: newPoints };
      let rewardUnlocked = false;

      // Check for reward unlock at 20 points
      if (newPoints >= 20 && !profile.has_sausage_reward) {
        updateData.has_sausage_reward = true;
        rewardUnlocked = true;
        
        // Send reward notification
        await supabase.from('notifications').insert({
          user_id: duty.assigned_to,
          type: 'reward_unlocked',
          message: '🌭 Reward unlocked! You\'ve earned a free sausage sizzle!',
        });
        console.log(`User ${duty.assigned_to}: Sausage reward unlocked!`);
      }

      // Update profile with new points
      await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', duty.assigned_to);

      // Record in points history
      await supabase.from('points_history').insert({
        user_id: duty.assigned_to,
        club_id: club?.id || null,
        amount: 10,
        balance_after: newPoints,
        source_type: 'duty',
        source_id: duty.id,
        description: 'Game duty completed',
      });

      // Mark duty as points awarded
      await supabase
        .from('duties')
        .update({ points_awarded: true })
        .eq('id', duty.id);

      // Send points notification
      await supabase.from('notifications').insert({
        user_id: duty.assigned_to,
        type: 'points_awarded',
        message: 'You earned 10 Ignite points for your game duty! 🔥',
        related_id: event.id,
      });

      // Send points email notification
      try {
        const { error: emailError } = await supabase.functions.invoke('send-points-notification-email', {
          body: {
            recipientUserId: duty.assigned_to,
            pointsAwarded: 10,
            reason: 'Game duty completed',
            totalPoints: newPoints,
            clubName: club?.name || 'Your Club',
            clubLogoUrl: club?.logo_url,
            rewardUnlocked,
            rewardName: rewardUnlocked ? 'Free Sausage Sizzle' : undefined,
          },
        });

        if (!emailError) {
          emailsSent++;
          console.log(`Points email sent to user ${duty.assigned_to}`);
        } else {
          console.error(`Failed to send points email to user ${duty.assigned_to}:`, emailError);
        }
      } catch (emailErr) {
        console.error(`Error sending points email:`, emailErr);
      }

      processedCount++;
      pointsAwarded += 10;
      console.log(`Duty ${duty.id}: Awarded 10 points to user ${duty.assigned_to} (total: ${newPoints})`);
    }

    console.log(`Processing complete. Processed: ${processedCount}, Points awarded: ${pointsAwarded}, Emails sent: ${emailsSent}`);

    return new Response(
      JSON.stringify({
        success: true,
        processedCount,
        pointsAwarded,
        emailsSent,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error processing duty points:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
