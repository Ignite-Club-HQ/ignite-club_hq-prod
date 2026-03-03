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

// Get coaches and team admins for a specific team
async function getTeamStaffUserIds(supabase: any, teamId: string | null | undefined): Promise<string[]> {
  if (!teamId) return [];

  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('team_id', teamId)
    .in('role', ['team_admin', 'coach']);

  if (error || !data) {
    console.error('[CHECK-SUBS] Error fetching team staff:', error?.message);
    return [];
  }

  // Deduplicate
  return [...new Set(data.map((r: any) => r.user_id as string))];
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
  // Build recipient list: game owner + team staff (deduplicated)
  const allRecipients = new Set<string>([gameOwnerId, ...staffUserIds]);
  let notificationsSent = 0;

  const pushUrl = linkedEventId
    ? `/events/${linkedEventId}`
    : '/pitch-board';
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

    // Push notification
    await sendPushNotification(supabase, userId, pushTitle, pushBody, pushUrl, pushTag, 'pitch_board');

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
    if (!timerState.isRunning) continue;
    if (!pitchState.autoSubActive || pitchState.autoSubPaused || !pitchState.autoSubPlan?.length) continue;

    const now = Date.now();

    // Skip stale games - if lastUpdateTime is more than 2 minutes ago,
    // the client has stopped syncing and this game is abandoned
    const STALE_THRESHOLD_MS = 120_000; // 2 minutes
    if (timerState.lastUpdateTime > 0 && (now - timerState.lastUpdateTime) > STALE_THRESHOLD_MS) {
      console.log(`[CHECK-SUBS] Game ${game.id} is stale (last update ${Math.floor((now - timerState.lastUpdateTime) / 1000)}s ago), marking inactive`);
      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', game.id);
      continue;
    }

    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;
    const halfDurationSecs = timerState.minutesPerHalf * 60;
    const teamName = timerState.teamName || 'Your team';
    const teamId = timerState.teamId || game.team_id;
    const linkedEventId = pitchState.linkedEventId;

    // Get team staff (coaches + team_admins) for this specific team
    const staffUserIds = await getTeamStaffUserIds(supabase, teamId);

    const getAbsoluteSubTime = (sub: SubstitutionEvent) => {
      return sub.half === 1 ? sub.time : halfDurationSecs + sub.time;
    };

    // Find next unexecuted sub for current half that's due
    const nextSub = pitchState.autoSubPlan.find((sub: SubstitutionEvent) => {
      const absoluteSubTime = getAbsoluteSubTime(sub);
      return !sub.executed &&
        sub.half === currentHalf &&
        currentElapsed >= sub.time &&
        absoluteSubTime > (game.last_sub_check_time || 0);
    });

    if (nextSub) {
      const playerOutName = nextSub.playerOut.name || `#${nextSub.playerOut.number}`;
      const playerInName = nextSub.playerIn.name || `#${nextSub.playerIn.number}`;
      const position = nextSub.playerOut.currentPitchPosition || 'Pitch';
      const notificationBody = `${playerOutName} → Bench. ${playerInName} → ${position}`;
      const elapsedMinutes = Math.floor(currentElapsed / 60);

      console.log(`[CHECK-SUBS] Game ${game.id}: Sub due at ${nextSub.time}s, current=${currentElapsed}s`);

      notificationsSent += await notifyTeamStaff(
        supabase, staffUserIds, game.user_id, game.id,
        teamId, teamName, linkedEventId,
        'pending_sub', notificationBody, 'pending_sub',
        `🔄 ${teamName} - Sub Due!`, notificationBody,
        playerOutName, playerInName, position, elapsedMinutes, currentHalf
      );

      // Update last_sub_check_time with ABSOLUTE time
      const absoluteSubTime = getAbsoluteSubTime(nextSub);
      const { error: updateError } = await supabase
        .from('active_games')
        .update({ last_sub_check_time: absoluteSubTime })
        .eq('id', game.id);

      if (updateError) {
        console.error(`[CHECK-SUBS] Failed to update last_sub_check_time:`, updateError.message);
      }
    }

    // Check for half time
    const isHalfTime = currentHalf === 1 && currentElapsed >= halfDurationSecs;

    if (isHalfTime) {
      const halfTimeMarker = game.last_sub_check_time || 0;

      if (halfTimeMarker < halfDurationSecs) {
        notificationsSent += await notifyTeamStaff(
          supabase, staffUserIds, game.user_id, game.id,
          teamId, teamName, linkedEventId,
          'half_time', `⏸️ ${teamName} - Half Time!`, 'half_time',
          `⏸️ Half Time!`, `${teamName} - Half Time`,
          undefined, undefined, undefined, timerState.minutesPerHalf, 1
        );

        console.log(`[CHECK-SUBS] Half time notification sent for game ${game.id}`);
      }
    }

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
