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

      // Check if club has disabled the points system
      if (canAwardPoints && club?.id) {
        const { data: clubSub } = await supabase
          .from('club_subscriptions')
          .select('disable_points_system')
          .eq('club_id', club.id)
          .maybeSingle();
        
        if (clubSub?.disable_points_system) {
          canAwardPoints = false;
        }
      }

      if (!canAwardPoints) {
        // Mark as processed but don't award points
        await supabase
          .from('duties')
          .update({ points_awarded: true })
          .eq('id', duty.id);
        processedCount++;
        console.log(`Duty ${duty.id}: Marked as processed (points not enabled)`);
        continue;
      }

      // Get current profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('ignite_points')
        .eq('id', duty.assigned_to)
        .single();

      if (!profile) {
        console.log(`Duty ${duty.id}: User ${duty.assigned_to} not found, skipping`);
        continue;
      }

      const newPoints = (profile.ignite_points || 0) + 10;
      const updateData: any = { ignite_points: newPoints };
      let rewardUnlocked = false;
      let rewardName: string | undefined;

      // Check if user has reached any club reward threshold
      const { data: availableRewards } = await supabase
        .from('club_rewards')
        .select('id, name, points_required')
        .eq('club_id', club?.id)
        .eq('is_active', true)
        .lte('points_required', newPoints)
        .order('points_required', { ascending: false })
        .limit(1);

      if (availableRewards && availableRewards.length > 0) {
        const reward = availableRewards[0];
        // Only notify if they just crossed this threshold (old points were below)
        if ((profile.ignite_points || 0) < reward.points_required) {
          rewardUnlocked = true;
          rewardName = reward.name;

          await supabase.from('notifications').insert({
            user_id: duty.assigned_to,
            type: 'reward_unlocked',
            message: `🎁 Reward unlocked! You've earned: ${reward.name}!`,
          });
          console.log(`User ${duty.assigned_to}: Reward "${reward.name}" unlocked!`);
        }
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
        message: 'You earned 10 points for your game duty! 🔥',
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
            rewardName: rewardUnlocked ? rewardName : undefined,
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

    // ============================================
    // PART 2: Process attendance points for ALL members
    // Coaches/team_admins get 10 pts, regular members get 3 pts
    // ============================================
    console.log('Processing attendance points for all members...');

    // Find events that ended 24+ hours ago with RSVPs that haven't been awarded
    const { data: eligibleRsvps, error: rsvpError } = await supabase
      .from('rsvps')
      .select(`
        id,
        user_id,
        event_id,
        events!inner (
          id,
          event_date,
          club_id,
          team_id,
          type,
          clubs!inner (
            id,
            name,
            logo_url,
            is_pro
          )
        )
      `)
      .eq('status', 'going')
      .eq('attendance_points_awarded', false)
      .is('child_id', null)
      .lt('events.event_date', twentyFourHoursAgo);

    if (rsvpError) {
      console.error('Error fetching eligible RSVPs:', rsvpError);
    }

    let attendanceProcessed = 0;
    let attendancePointsAwarded = 0;

    for (const rsvp of eligibleRsvps || []) {
      const event = rsvp.events as any;
      const club = event?.clubs;

      // Check Pro status
      let isPro = club?.is_pro === true;
      if (!isPro && event?.team_id) {
        const { data: teamSub } = await supabase
          .from('team_subscriptions')
          .select('is_pro, is_pro_football')
          .eq('team_id', event.team_id)
          .maybeSingle();
        isPro = teamSub?.is_pro === true || teamSub?.is_pro_football === true;
      }

      // Check if points system is disabled
      if (isPro && club?.id) {
        const { data: clubSub } = await supabase
          .from('club_subscriptions')
          .select('disable_points_system')
          .eq('club_id', club.id)
          .maybeSingle();
        if (clubSub?.disable_points_system) {
          isPro = false;
        }
      }

      if (!isPro) {
        await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);
        attendanceProcessed++;
        continue;
      }

      // Determine points based on role: coaches/team_admins get 10, everyone else gets 3
      const teamId = event?.team_id;
      let attendancePts = 3; // Default for regular members
      let roleLabel = 'member';

      if (teamId) {
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', rsvp.user_id)
          .eq('team_id', teamId)
          .in('role', ['coach', 'team_admin'])
          .maybeSingle();

        if (userRole) {
          attendancePts = 10;
          roleLabel = userRole.role;
        }
      }

      // Award points
      const { data: profile } = await supabase
        .from('profiles')
        .select('ignite_points')
        .eq('id', rsvp.user_id)
        .single();

      if (!profile) {
        await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);
        attendanceProcessed++;
        continue;
      }

      const previousPts = profile.ignite_points || 0;
      const newPts = previousPts + attendancePts;

      await supabase.from('profiles').update({ ignite_points: newPts }).eq('id', rsvp.user_id);

      await supabase.from('points_history').insert({
        user_id: rsvp.user_id,
        club_id: club?.id || null,
        amount: attendancePts,
        balance_after: newPts,
        source_type: 'attendance',
        source_id: event.id,
        description: roleLabel === 'member'
          ? 'Event attendance bonus'
          : `Match attendance (${roleLabel})`,
      });

      await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);

      // Check reward threshold
      let attendanceRewardUnlocked = false;
      let attendanceRewardName: string | undefined;
      const { data: attendanceRewards } = await supabase
        .from('club_rewards')
        .select('id, name, points_required')
        .eq('club_id', club?.id)
        .eq('is_active', true)
        .lte('points_required', newPts)
        .gt('points_required', previousPts)
        .order('points_required', { ascending: false })
        .limit(1);

      if (attendanceRewards && attendanceRewards.length > 0) {
        attendanceRewardUnlocked = true;
        attendanceRewardName = attendanceRewards[0].name;
        await supabase.from('notifications').insert({
          user_id: rsvp.user_id,
          type: 'reward_unlocked',
          message: `🎁 Reward unlocked! You've earned: ${attendanceRewardName}!`,
        });
      }

      await supabase.from('notifications').insert({
        user_id: rsvp.user_id,
        type: 'points_awarded',
        message: `You earned ${attendancePts} points for attending! 🔥`,
        related_id: event.id,
      });

      // Send email
      try {
        await supabase.functions.invoke('send-points-notification-email', {
          body: {
            recipientUserId: rsvp.user_id,
            pointsAwarded: attendancePts,
            reason: roleLabel === 'member' ? 'Event attendance' : `Match attendance (${roleLabel})`,
            totalPoints: newPts,
            clubName: club?.name || 'Your Club',
            clubLogoUrl: club?.logo_url,
            rewardUnlocked: attendanceRewardUnlocked,
            rewardName: attendanceRewardName,
          },
        });
        emailsSent++;
      } catch (e) {
        console.error('Error sending attendance points email:', e);
      }

      attendanceProcessed++;
      attendancePointsAwarded += attendancePts;
      console.log(`RSVP ${rsvp.id}: Awarded ${attendancePts} attendance points to ${roleLabel} ${rsvp.user_id} (total: ${newPts})`);
    }

    const totalPoints = pointsAwarded + attendancePointsAwarded;
    console.log(`Processing complete. Duties: ${processedCount}, Attendance: ${attendanceProcessed}, Total points: ${totalPoints}, Emails: ${emailsSent}`);

    return new Response(
      JSON.stringify({
        success: true,
        processedCount,
        pointsAwarded,
        attendanceProcessed,
        attendancePointsAwarded,
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
