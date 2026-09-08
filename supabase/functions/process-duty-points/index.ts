import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await isAuthorizedCronCaller(req))) {
    console.error('Unauthorized: caller is not an authorized cron/internal caller');
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
      
      // Check if club/team has Pro subscription (required for points)
      let canAwardPoints = false;
      
      // Check club subscription first
      if (club?.id) {
        const { data: clubSub } = await supabase
          .from('club_subscriptions')
          .select('is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, disable_points_system')
          .eq('club_id', club.id)
          .maybeSingle();
        
        canAwardPoints = !!(clubSub?.is_pro || clubSub?.is_pro_football || 
                           clubSub?.admin_pro_override || clubSub?.admin_pro_football_override);
        
        if (canAwardPoints && clubSub?.disable_points_system) {
          canAwardPoints = false;
        }
      }
      
      // If club doesn't have Pro, check team subscription
      if (!canAwardPoints && event?.team_id) {
        const { data: teamSub } = await supabase
          .from('team_subscriptions')
          .select('is_pro, is_pro_football, admin_pro_override, admin_pro_football_override')
          .eq('team_id', event.team_id)
          .maybeSingle();
        
        canAwardPoints = !!(teamSub?.is_pro || teamSub?.is_pro_football || 
                           teamSub?.admin_pro_override || teamSub?.admin_pro_football_override);
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

      // Atomic points increment
      const { data: newPointsResult, error: rpcError } = await supabase.rpc('increment_ignite_points', {
        _user_id: duty.assigned_to,
        _amount: 10,
        _club_id: club?.id ?? null,
      });

      if (rpcError) {
        console.log(`Duty ${duty.id}: Failed to increment points for ${duty.assigned_to}: ${rpcError.message}`);
        continue;
      }

      const newPoints = newPointsResult || 0;
      const previousPoints = newPoints - 10;
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
        if (previousPoints < reward.points_required) {
          rewardUnlocked = true;
          rewardName = reward.name;

          await supabase.from('notifications').insert({
            user_id: duty.assigned_to,
            type: 'reward_unlocked',
            message: `🎁 Reward unlocked! You've earned: ${reward.name}!`,
            club_id: club?.id || null,
          });
          console.log(`User ${duty.assigned_to}: Reward "${reward.name}" unlocked!`);
        }
      }

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

      // Determine points based on role: coaches/team_admins get 10, everyone else gets 5
      const teamId = event?.team_id;
      let attendancePts = 5; // Default for regular members
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

      // Atomic points increment
      const { data: newPtsResult, error: attRpcError } = await supabase.rpc('increment_ignite_points', {
        _user_id: rsvp.user_id,
        _amount: attendancePts,
        _club_id: club?.id ?? null,
      });

      if (attRpcError) {
        await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);
        attendanceProcessed++;
        continue;
      }

      const newPts = newPtsResult || 0;
      const previousPts = newPts - attendancePts;

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
          club_id: club?.id || null,
        });
      }

      await supabase.from('notifications').insert({
        user_id: rsvp.user_id,
        type: 'points_awarded',
        message: `You earned ${attendancePts} points for attending! 🔥`,
        related_id: event.id,
        club_id: club?.id || null,
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

    // ── CHILD attendance points ──
    let childAttendanceProcessed = 0;
    let childAttendancePointsAwarded = 0;

    const { data: childRsvps, error: childRsvpError } = await supabase
      .from('rsvps')
      .select(`
        id,
        child_id,
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
      .not('child_id', 'is', null)
      .lt('events.event_date', twentyFourHoursAgo);

    if (childRsvpError) {
      console.error('Error fetching child RSVPs:', childRsvpError);
    }

    for (const rsvp of childRsvps || []) {
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
        childAttendanceProcessed++;
        continue;
      }

      const childAttendancePts = 3;

      const { data: childNewPts, error: childRpcErr } = await supabase.rpc('increment_child_ignite_points', {
        _child_id: rsvp.child_id,
        _amount: childAttendancePts,
        _club_id: club?.id ?? null,
      });

      if (childRpcErr) {
        console.error(`Error awarding child attendance points for child ${rsvp.child_id}:`, childRpcErr);
        await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);
        childAttendanceProcessed++;
        continue;
      }

      const childNewBalance = childNewPts || 0;
      const childPreviousBalance = childNewBalance - childAttendancePts;

      await supabase.from('points_history').insert({
        child_id: rsvp.child_id,
        user_id: rsvp.user_id,
        club_id: club?.id || null,
        amount: childAttendancePts,
        balance_after: childNewBalance,
        source_type: 'attendance',
        source_id: event.id,
        description: 'Event attendance bonus',
      });

      await supabase.from('rsvps').update({ attendance_points_awarded: true }).eq('id', rsvp.id);

      // Check reward threshold for child
      const { data: childRewards } = await supabase
        .from('club_rewards')
        .select('id, name, points_required')
        .eq('club_id', club?.id)
        .eq('is_active', true)
        .lte('points_required', childNewBalance)
        .gt('points_required', childPreviousBalance)
        .order('points_required', { ascending: false })
        .limit(1);

      let childRewardUnlocked = false;
      let childRewardName: string | undefined;
      if (childRewards && childRewards.length > 0) {
        childRewardUnlocked = true;
        childRewardName = childRewards[0].name;
      }

      // Get child name for notification
      const { data: childData } = await supabase
        .from('children')
        .select('name')
        .eq('id', rsvp.child_id)
        .single();
      const childName = childData?.name || 'Your child';

      // Notify parent
      if (rsvp.user_id) {
        if (childRewardUnlocked) {
          await supabase.from('notifications').insert({
            user_id: rsvp.user_id,
            type: 'reward_unlocked',
            message: `🎁 ${childName} unlocked a reward: ${childRewardName}!`,
            club_id: club?.id || null,
          });
        }
        await supabase.from('notifications').insert({
          user_id: rsvp.user_id,
          type: 'points_awarded',
          message: `${childName} earned ${childAttendancePts} points for attending! 🔥`,
          related_id: event.id,
          club_id: club?.id || null,
        });

        // Send email to parent
        try {
          await supabase.functions.invoke('send-points-notification-email', {
            body: {
              recipientUserId: rsvp.user_id,
              pointsAwarded: childAttendancePts,
              reason: `${childName} – Event attendance`,
              totalPoints: childNewBalance,
              clubName: club?.name || 'Your Club',
              clubLogoUrl: club?.logo_url,
              rewardUnlocked: childRewardUnlocked,
              rewardName: childRewardName,
            },
          });
          emailsSent++;
        } catch (e) {
          console.error('Error sending child attendance points email:', e);
        }
      }

      childAttendanceProcessed++;
      childAttendancePointsAwarded += childAttendancePts;
      console.log(`Child RSVP ${rsvp.id}: Awarded ${childAttendancePts} attendance points to child ${rsvp.child_id} (total: ${childNewBalance})`);
    }

    const totalPoints = pointsAwarded + attendancePointsAwarded + childAttendancePointsAwarded;
    console.log(`Processing complete. Duties: ${processedCount}, Attendance: ${attendanceProcessed}, Child attendance: ${childAttendanceProcessed}, Total points: ${totalPoints}, Emails: ${emailsSent}`);

    return new Response(
      JSON.stringify({
        success: true,
        processedCount,
        pointsAwarded,
        attendanceProcessed,
        attendancePointsAwarded,
        childAttendanceProcessed,
        childAttendancePointsAwarded,
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
