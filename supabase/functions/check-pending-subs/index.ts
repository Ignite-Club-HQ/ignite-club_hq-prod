import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TimerState {
  elapsedSeconds: number;
  isRunning: boolean;
  currentHalf: number;
  minutesPerHalf: number;
  lastUpdateTime: number;
  teamName?: string;
  teamId?: string;
}

interface Player {
  id: string;
  name: string;
  number: number;
  position?: { x: number; y: number };
  isOnPitch: boolean;
  playTime: number;
  currentPitchPosition?: string;
}

interface SubstitutionEvent {
  time: number;
  half: number;
  playerOut: Player;
  playerIn: Player;
  executed: boolean;
}

interface PitchState {
  players: Player[];
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused?: boolean;
  linkedEventId?: string;
}

const CHECK_INTERVAL_MS = 10000;
const TOTAL_DURATION_MS = 55000;

// Get notification recipients for a specific team/match
// For mini-league matches (event-group-*), only the Referee receives notifications
// For regular teams, coaches/admins and Subs Manager assignees receive notifications
async function getTeamStaffUserIds(supabase: any, teamId: string | null | undefined, linkedEventId?: string): Promise<string[]> {
  const userIds = new Set<string>();

  const isMiniLeague = teamId?.startsWith('event-group-');

  if (isMiniLeague) {
    // Mini-league: only notify the Referee of this specific match
    const groupId = teamId!.replace('event-group-', '');
    const { data: referees } = await supabase
      .from('event_group_duties')
      .select('assigned_to')
      .eq('group_id', groupId)
      .eq('name', 'Referee')
      .not('assigned_to', 'is', null);
    
    referees?.forEach((d: any) => {
      if (d.assigned_to) userIds.add(d.assigned_to);
    });

    console.log(`[CHECK-SUBS] Mini-league match ${groupId}: ${userIds.size} referee(s) found`);
  } else {
    // Regular team: notify coaches/admins
    if (teamId) {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('team_id', teamId)
        .in('role', ['team_admin', 'coach']);

      if (error) {
        console.error('[CHECK-SUBS] Error fetching team staff:', error?.message);
      } else if (data) {
        data.forEach((r: any) => userIds.add(r.user_id as string));
      }
    }

    // Also include Subs Manager duty assignees for regular events
    if (linkedEventId) {
      const { data: dutyAssignees } = await supabase
        .from('duties')
        .select('assigned_to')
        .eq('event_id', linkedEventId)
        .eq('name', 'Subs Manager')
        .not('assigned_to', 'is', null);
      
      dutyAssignees?.forEach((d: any) => {
        if (d.assigned_to) userIds.add(d.assigned_to);
      });
    }
  }

  return [...userIds];
}

// Send push notification via edge function
async function sendPushNotification(
  supabase: any,
  userId: string,
  title: string,
  body: string,
  url: string,
  tag: string,
  notificationType: string
) {
  try {
    await supabase.functions.invoke('send-push-notification', {
      body: {
        userId,
        title,
        body,
        url,
        tag,
        notificationType: 'pitch_board',
      },
    });
  } catch (err) {
    console.error(`[CHECK-SUBS] Push error for user ${userId}:`, err);
  }
}

// Send email notification for pitch board events
async function sendPitchBoardEmail(
  supabase: any,
  userId: string,
  teamId: string | undefined,
  teamName: string,
  notificationType: 'pending_sub' | 'half_time' | 'full_time' | 'game_linked',
  notificationMessage: string,
  eventId?: string,
  playerOutName?: string,
  playerInName?: string,
  position?: string,
  elapsedMinutes?: number,
  currentHalf?: number
) {
  try {
    const { error } = await supabase.functions.invoke('send-pitch-board-notification-email', {
      body: {
        recipientUserId: userId,
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
      },
    });

    if (error) {
      console.error(`[CHECK-SUBS] Failed to send email for ${notificationType}:`, error.message);
    }
  } catch (err) {
    console.error(`[CHECK-SUBS] Error invoking email function:`, err);
  }
}

// Check notification preferences for a user
async function isNotificationEnabled(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('pitch_board_enabled')
    .eq('user_id', userId)
    .single();

  return data?.pitch_board_enabled !== false;
}

// Notify all team staff (in-app, push, email) for a pitch board event
async function notifyTeamStaff(
  supabase: any,
  staffUserIds: string[],
  gameOwnerId: string,
  gameId: string,
  teamId: string | undefined,
  teamName: string,
  linkedEventId: string | undefined,
  notificationType: 'pending_sub' | 'half_time' | 'full_time',
  notificationMessage: string,
  inAppType: string,
  pushTitle: string,
  pushBody: string,
  playerOutName?: string,
  playerInName?: string,
  position?: string,
  elapsedMinutes?: number,
  currentHalf?: number,
) {
  // For mini-league matches, only notify referees (staffUserIds already filtered)
  // For regular teams, include game owner + team staff
  const isMiniLeague = teamId?.startsWith('event-group-');
  const allRecipients = isMiniLeague
    ? new Set<string>(staffUserIds)
    : new Set<string>([gameOwnerId, ...staffUserIds]);
  let notificationsSent = 0;

  const pushUrl = linkedEventId
    ? `/events/${linkedEventId}`
    : '/notifications';
  const pushTag = `${notificationType}-${gameId}`;

  for (const userId of allRecipients) {
    const enabled = await isNotificationEnabled(supabase, userId);
    if (!enabled) continue;

    // In-app notification
    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: inAppType,
        message: notificationMessage,
        related_id: gameId,
      });

    if (!notifError) {
      notificationsSent++;
    } else {
      console.error(`[CHECK-SUBS] Notification insert error for ${userId}:`, notifError.message);
    }

    // Push notification is handled automatically by the DB trigger on notifications table insert
    // No need to call sendPushNotification explicitly here

    // Email notification
    await sendPitchBoardEmail(
      supabase, userId, teamId, teamName, notificationType,
      notificationMessage, linkedEventId,
      playerOutName, playerInName, position, elapsedMinutes, currentHalf
    );
  }

  return notificationsSent;
}

async function checkGames(supabase: any): Promise<number> {
  const { data: activeGames, error: gamesError } = await supabase
    .from('active_games')
    .select('*')
    .eq('is_active', true);

  if (gamesError) {
    console.error('[CHECK-SUBS] Error fetching active games:', gamesError);
    return 0;
  }

  if (!activeGames || activeGames.length === 0) {
    return 0;
  }

  let notificationsSent = 0;

  for (const game of activeGames) {
    const timerState = game.timer_state as TimerState;
    const pitchState = game.pitch_state as PitchState;

    if (!timerState || !pitchState) continue;

    const hasAutoSub = pitchState.autoSubActive && !pitchState.autoSubPaused && pitchState.autoSubPlan?.length > 0;

    const now = Date.now();
    const halfDurationSecs = timerState.minutesPerHalf * 60;

    // Calculate current elapsed time
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const rawElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    
    // Cap elapsed at half duration - if we're past it, the client is at half-time/full-time
    // and hasn't transitioned yet. Don't let the elapsed overshoot.
    const currentElapsed = Math.min(rawElapsed, halfDurationSecs);
    const currentHalf = timerState.currentHalf;

    // Detect half-time boundary: elapsed has reached/exceeded half duration
    // This works whether timer is running (extrapolated) or paused (elapsedSeconds already at boundary)
    const isAtHalfTimeBoundary = timerState.currentHalf === 1 && rawElapsed >= halfDurationSecs;
    const isAtFullTimeBoundary = timerState.currentHalf === 2 && rawElapsed >= halfDurationSecs;

    // Skip stale games - if the DB row hasn't been updated recently,
    // the client has stopped syncing and this game is abandoned.
    // Use game.updated_at (set by client sync every 10s) NOT timerState.lastUpdateTime
    // (which is a frozen snapshot from when the timer was last interacted with).
    // Use a generous threshold — mobile apps (Capacitor WebViews) aggressively throttle
    // or freeze JS timers when backgrounded, so heartbeats can be delayed significantly.
    // The server extrapolates elapsed time from lastUpdateTime, so a longer stale window
    // doesn't affect notification accuracy — it just delays cleanup of truly abandoned games.
    const STALE_THRESHOLD_MS = (isAtHalfTimeBoundary || isAtFullTimeBoundary) ? 1_200_000 : 900_000; // 20min at breaks, 15min normally
    const gameUpdatedAt = new Date(game.updated_at).getTime();
    if (gameUpdatedAt > 0 && (now - gameUpdatedAt) > STALE_THRESHOLD_MS) {
      console.log(`[CHECK-SUBS] Game ${game.id} is stale (DB row last updated ${Math.floor((now - gameUpdatedAt) / 1000)}s ago), marking inactive`);
      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', game.id);
      continue;
    }

    // If at half-time boundary, don't process subs - the game is paused between halves
    if (isAtHalfTimeBoundary) {
      // Still send half-time notification if not already sent
      const halfTimeMarker = game.last_sub_check_time || 0;
      if (halfTimeMarker < halfDurationSecs) {
        const teamName = timerState.teamName || 'Your team';
        const teamId = timerState.teamId || game.team_id;
        const linkedEventId = pitchState.linkedEventId;
        const staffUserIds = await getTeamStaffUserIds(supabase, teamId, linkedEventId);
        
        notificationsSent += await notifyTeamStaff(
          supabase, staffUserIds, game.user_id, game.id,
          teamId, teamName, linkedEventId,
          'half_time', `⏸️ ${teamName} - Half Time!`, 'half_time',
          `⏸️ Half Time!`, `${teamName} - Half Time`,
          undefined, undefined, undefined, timerState.minutesPerHalf, 1
        );
        
        // Mark half-time as notified
        await supabase
          .from('active_games')
          .update({ last_sub_check_time: halfDurationSecs })
          .eq('id', game.id);
        
        console.log(`[CHECK-SUBS] Half time notification sent for game ${game.id}`);
      }
      continue; // Skip sub processing during half-time
    }
    const teamName = timerState.teamName || 'Your team';
    const teamId = timerState.teamId || game.team_id;
    const linkedEventId = pitchState.linkedEventId;

    // Get team staff (coaches + team_admins) for this specific team
    const staffUserIds = await getTeamStaffUserIds(supabase, teamId, linkedEventId);

    // Only process substitution notifications if auto-sub is active AND timer is running
    if (hasAutoSub && timerState.isRunning) {
      const getAbsoluteSubTime = (sub: SubstitutionEvent) => {
        return sub.half === 1 ? sub.time : halfDurationSecs + sub.time;
      };

      // Find all unexecuted subs for current half that are due and not overdue
      const AUTO_SKIP_THRESHOLD_SECS = 60;
      const dueSubs = pitchState.autoSubPlan.filter((sub: SubstitutionEvent) => {
        const absoluteSubTime = getAbsoluteSubTime(sub);
        const overdueSeconds = currentElapsed - sub.time;
        return !sub.executed &&
          sub.half === currentHalf &&
          currentElapsed >= sub.time &&
          overdueSeconds <= AUTO_SKIP_THRESHOLD_SECS &&
          absoluteSubTime > (game.last_sub_check_time || 0);
      });

      // Also advance last_sub_check_time past any severely overdue subs so we don't re-check them
      const overdueSubs = pitchState.autoSubPlan.filter((sub: SubstitutionEvent) => {
        const absoluteSubTime = getAbsoluteSubTime(sub);
        const overdueSeconds = currentElapsed - sub.time;
        return !sub.executed &&
          sub.half === currentHalf &&
          currentElapsed >= sub.time &&
          overdueSeconds > AUTO_SKIP_THRESHOLD_SECS &&
          absoluteSubTime > (game.last_sub_check_time || 0);
      });

      if (overdueSubs.length > 0) {
        const maxOverdueAbsTime = Math.max(...overdueSubs.map((s: SubstitutionEvent) => getAbsoluteSubTime(s)));
        console.log(`[CHECK-SUBS] Game ${game.id}: Skipping ${overdueSubs.length} overdue sub(s) (>90s past due)`);
        await supabase
          .from('active_games')
          .update({ last_sub_check_time: Math.max(maxOverdueAbsTime, game.last_sub_check_time || 0) })
          .eq('id', game.id);
      }

      if (dueSubs.length > 0) {
        // Group by time to find concurrent subs (batch)
        const dueTimes = [...new Set(dueSubs.map((s: SubstitutionEvent) => s.time))].sort((a: number, b: number) => a - b);
        // Take the earliest due time group
        const earliestTime = dueTimes[0];
        const batchSubs = dueSubs.filter((s: SubstitutionEvent) => s.time === earliestTime);
        
        const elapsedMinutes = Math.floor(currentElapsed / 60);

        let notificationBody: string;
        let pushTitle: string;
        let playerOutName: string | undefined;
        let playerInName: string | undefined;
        let position: string | undefined;

        if (batchSubs.length === 1) {
          // Single sub
          const sub = batchSubs[0];
          playerOutName = sub.playerOut.name || `#${sub.playerOut.number}`;
          playerInName = sub.playerIn.name || `#${sub.playerIn.number}`;
          position = sub.playerOut.currentPitchPosition || 'Pitch';
          notificationBody = `${playerOutName} → Bench. ${playerInName} → ${position}`;
          pushTitle = `🔄 ${teamName} - Sub Due!`;
        } else {
          // Multiple concurrent subs — list all of them
          const subDescriptions = batchSubs.map((sub: SubstitutionEvent) => {
            const outName = sub.playerOut.name || `#${sub.playerOut.number}`;
            const inName = sub.playerIn.name || `#${sub.playerIn.number}`;
            const pos = sub.playerOut.currentPitchPosition || 'Pitch';
            return `${outName} → Bench, ${inName} → ${pos}`;
          });
          notificationBody = `${batchSubs.length} subs due: ${subDescriptions.join(' • ')}`;
          pushTitle = `🔄 ${teamName} - ${batchSubs.length} Subs Due!`;
          // Use first sub's details for email template fields
          playerOutName = batchSubs[0].playerOut.name || `#${batchSubs[0].playerOut.number}`;
          playerInName = batchSubs[0].playerIn.name || `#${batchSubs[0].playerIn.number}`;
          position = batchSubs[0].playerOut.currentPitchPosition || 'Pitch';
        }

        console.log(`[CHECK-SUBS] Game ${game.id}: ${batchSubs.length} sub(s) due at ${earliestTime}s, current=${currentElapsed}s`);

        notificationsSent += await notifyTeamStaff(
          supabase, staffUserIds, game.user_id, game.id,
          teamId, teamName, linkedEventId,
          'pending_sub', notificationBody, 'pending_sub',
          pushTitle, notificationBody,
          playerOutName, playerInName, position, elapsedMinutes, currentHalf
        );

        // Update last_sub_check_time with the max ABSOLUTE time of the batch
        const maxAbsTime = Math.max(...batchSubs.map((s: SubstitutionEvent) => getAbsoluteSubTime(s)));
        const { error: updateError } = await supabase
          .from('active_games')
          .update({ last_sub_check_time: maxAbsTime })
          .eq('id', game.id);

        if (updateError) {
          console.error(`[CHECK-SUBS] Failed to update last_sub_check_time:`, updateError.message);
        }
      }
    }

    // Half-time is now handled above (before sub processing) to avoid stale game issues

    // Check for game finished
    const isGameFinished = timerState.currentHalf === 2 && currentElapsed >= halfDurationSecs;

    if (isGameFinished) {
      console.log(`[CHECK-SUBS] Game ${game.id} finished`);

      notificationsSent += await notifyTeamStaff(
        supabase, staffUserIds, game.user_id, game.id,
        teamId, teamName, linkedEventId,
        'full_time', `🏆 ${teamName} - Full Time!`, 'game_finished',
        `🏆 Full Time!`, `${teamName} - Full Time`,
        undefined, undefined, undefined, timerState.minutesPerHalf * 2, 2
      );

      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', game.id);
    }
  }

  return notificationsSent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[CHECK-SUBS] Starting - will check every 10s for ~55s');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const startTime = Date.now();
  let totalNotifications = 0;
  let checksPerformed = 0;

  while (Date.now() - startTime < TOTAL_DURATION_MS) {
    checksPerformed++;
    const notifications = await checkGames(supabase);
    totalNotifications += notifications;

    if (notifications > 0) {
      console.log(`[CHECK-SUBS] Check #${checksPerformed}: sent ${notifications} notification(s)`);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed + CHECK_INTERVAL_MS < TOTAL_DURATION_MS) {
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
    } else {
      break;
    }
  }

  console.log(`[CHECK-SUBS] Complete: ${checksPerformed} checks, ${totalNotifications} total notifications`);

  return new Response(JSON.stringify({
    message: 'Checks complete',
    checksPerformed,
    totalNotifications
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
