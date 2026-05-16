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
// For regular teams, notify staff scoped to THIS team only, plus any assigned match duties
async function getTeamStaffUserIds(supabase: any, teamId: string | null | undefined, linkedEventId?: string): Promise<string[]> {
  const userIds = new Set<string>();

  const isMiniLeague = teamId?.startsWith('event-group-');

  if (isMiniLeague) {
    // Mini-league: only notify the Referee of this specific match
    const groupId = teamId!.replace('event-group-', '');
    const { data: matchDutyAssignees } = await supabase
      .from('event_group_duties')
      .select('assigned_to')
      .eq('group_id', groupId)
      .in('name', ['Referee', 'Subs Manager'])
      .not('assigned_to', 'is', null);

    matchDutyAssignees?.forEach((d: any) => {
      if (d.assigned_to) userIds.add(d.assigned_to);
    });

    console.log(`[CHECK-SUBS] Mini-league match ${groupId}: ${userIds.size} duty assignee(s) found`);
  } else {
    if (teamId) {
      // Only team admins receive pitch-board pushes (pending sub, half time,
      // full time). Coaches can watch live without being pinged. The Subs
      // Manager duty assignee is appended below.
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('role', 'team_admin');

      if (error) {
        console.error('[CHECK-SUBS] Error fetching team staff:', error?.message);
      } else {
        data?.forEach((r: any) => userIds.add(r.user_id as string));
      }
    }

    if (linkedEventId) {
      const { data: dutyAssignees } = await supabase
        .from('duties')
        .select('assigned_to')
        .eq('event_id', linkedEventId)
        .in('name', ['Subs Manager', 'Referee'])
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
  notificationType: string,
  notificationId?: string
) {
  try {
    await supabase.functions.invoke('send-push-notification', {
      body: {
        userId,
        title,
        body,
        url,
        tag,
        notificationType,
        // Pass notificationId so send-push-notification creates a push_notification_log entry,
        // preventing retry-missed-push-notifications from re-sending this push.
        notificationId: notificationId || undefined,
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

// Batch-check notification preferences for multiple users
async function getEnabledUserIds(supabase: any, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  
  const { data } = await supabase
    .from('notification_preferences')
    .select('user_id, pitch_board_enabled')
    .in('user_id', userIds);

  const disabledUsers = new Set(
    (data || []).filter((p: any) => p.pitch_board_enabled === false).map((p: any) => p.user_id)
  );

  // Users without preferences default to enabled
  return new Set(userIds.filter(id => !disabledUsers.has(id)));
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
  // Only notify users who are actual staff/duty assignees for this team or event.
  // The game owner (whoever opened the pitch board) is intentionally NOT auto-included:
  // app_admins and cross-club admins can open any team's board, and they should not
  // receive sub notifications for teams they don't coach. Include the owner ONLY if
  // they are also in the staff list (i.e. a real coach / team_admin / duty assignee).
  const isMiniLeague = teamId?.startsWith('event-group-');
  const allRecipients = new Set<string>(staffUserIds);
  if (!isMiniLeague && staffUserIds.includes(gameOwnerId)) {
    allRecipients.add(gameOwnerId);
  }
  let notificationsSent = 0;

  // Deduplicate notifications before fan-out.
  // Full-time should only ever fire once per game, even if a stale client accidentally
  // re-syncs the same active_game row after the server marked it inactive.
  const firstRecipient = Array.from(allRecipients)[0];
  if (firstRecipient) {
    let recentNotifs;

    if (notificationType === 'full_time') {
      const fullTimeDedupCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const result = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', firstRecipient)
        .eq('type', inAppType)
        .eq('message', notificationMessage)
        .gte('created_at', fullTimeDedupCutoff)
        .limit(1);

      recentNotifs = result.data;
    } else {
      // Use a tight dedup window (30s) for pending_sub notifications.
      // The old 120s window blocked sequential sub batches in short halves
      // (e.g., subs at 1:40 and 3:20 would be only 100s apart, causing the
      // second to be silently dropped). 30s is enough to cover concurrent
      // cron invocations without blocking legitimate back-to-back subs.
      const dedupWindowSeconds = 30;
      const cutoff = new Date(Date.now() - dedupWindowSeconds * 1000).toISOString();
      const result = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', firstRecipient)
        .eq('type', inAppType)
        .eq('related_id', gameId)
        .gte('created_at', cutoff)
        .limit(1);

      recentNotifs = result.data;
    }

    if (recentNotifs && recentNotifs.length > 0) {
      console.log(`[CHECK-SUBS] Skipping duplicate ${notificationType} for game ${gameId}`);
      return 0;
    }
  }

  // Batch-check preferences for all recipients at once (single DB query)
  const enabledUsers = await getEnabledUserIds(supabase, Array.from(allRecipients));

  // Batch-insert all in-app notifications at once
  const notifInserts = Array.from(enabledUsers).map(userId => ({
    user_id: userId,
    type: inAppType,
    message: notificationMessage,
    related_id: gameId,
    skip_push: true,
  }));

  const insertedNotifMap = new Map<string, string>();
  if (notifInserts.length > 0) {
    const { data: notifData, error: notifError } = await supabase
      .from('notifications')
      .insert(notifInserts)
      .select('id, user_id');

    if (notifError) {
      console.error(`[CHECK-SUBS] Batch notification insert error:`, notifError.message);
    } else {
      notificationsSent = (notifData || []).length;
      for (const n of (notifData || [])) {
        insertedNotifMap.set(n.user_id, n.id);
      }
    }
  }

  // Fire push + email for ALL recipients in parallel (no more sequential awaits)
  const deliveryPromises: Promise<void>[] = [];
  for (const userId of enabledUsers) {
    const insertedNotifId = insertedNotifMap.get(userId);

    // Push notification (don't await individually)
    deliveryPromises.push(
      sendPushNotification(
        supabase, userId, pushTitle, pushBody,
        '/',
        `pitch-${notificationType}-${gameId}`,
        'pitch_board',
        insertedNotifId
      )
    );

    // Email notification (don't await individually)
    deliveryPromises.push(
      sendPitchBoardEmail(
        supabase, userId, teamId, teamName, notificationType,
        notificationMessage, linkedEventId,
        playerOutName, playerInName, position, elapsedMinutes, currentHalf
      )
    );
  }

  // Wait for all push + email deliveries in parallel
  await Promise.allSettled(deliveryPromises);

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

  // Deduplicate: if multiple active rows exist for the same user+team, keep
  // only the most recently updated one and deactivate the rest.
  // This prevents duplicate notifications from ghost rows.
  const seen = new Map<string, typeof activeGames[0]>();
  const duplicateIds: string[] = [];
  for (const game of activeGames) {
    const key = `${game.user_id}::${game.team_id || ''}`;
    const existing = seen.get(key);
    if (existing) {
      // Keep the newer one
      const existingTime = new Date(existing.updated_at).getTime();
      const gameTime = new Date(game.updated_at).getTime();
      if (gameTime > existingTime) {
        duplicateIds.push(existing.id);
        seen.set(key, game);
      } else {
        duplicateIds.push(game.id);
      }
    } else {
      seen.set(key, game);
    }
  }
  if (duplicateIds.length > 0) {
    console.log(`[CHECK-SUBS] Deactivating ${duplicateIds.length} duplicate active_games rows`);
    await supabase
      .from('active_games')
      .update({ is_active: false })
      .in('id', duplicateIds);
  }

  // Only process deduplicated games
  const uniqueGames = [...seen.values()];

  let notificationsSent = 0;

  for (const game of uniqueGames) {
    const timerState = game.timer_state as TimerState;
    const pitchState = game.pitch_state as PitchState;

    if (!timerState || !pitchState) continue;

    const hasAutoSub = pitchState.autoSubActive && !pitchState.autoSubPaused && pitchState.autoSubPlan?.length > 0;

    const now = Date.now();
    const halfDurationSecs = timerState.minutesPerHalf * 60;

    // Calculate current elapsed time
    // IMPORTANT: Use the DB-side updated_at timestamp as the time anchor instead of
    // the client-side lastUpdateTime. Client clocks can drift vs server, causing
    // early/late sub notifications. The DB timestamp is authoritative.
    const dbUpdatedAtMs = new Date(game.updated_at).getTime();
    const timeSinceDbUpdateRaw = Math.max(0, Math.floor((now - dbUpdatedAtMs) / 1000));
    
    // Cap extrapolation to 30s for BOUNDARY detection (halftime/fulltime) only.
    // Without the cap, a backgrounded app (no syncs for minutes) would cause the
    // server to falsely trigger halftime/fulltime notifications mid-half.
    const MAX_EXTRAPOLATION_SECS = 30;
    const timeSinceDbUpdateCapped = Math.min(timeSinceDbUpdateRaw, MAX_EXTRAPOLATION_SECS);
    const rawElapsedCapped = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceDbUpdateCapped : 0);
    
    // For SUB detection, use UNCAPPED extrapolation (still bounded by half duration).
    // When the app is backgrounded, the whole point of server-side checking is to
    // detect subs that the client can't process. Without uncapped extrapolation,
    // subs due >30s after the last sync are invisible to the server.
    const rawElapsedUncapped = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceDbUpdateRaw : 0);
    const currentElapsedForSubs = Math.min(rawElapsedUncapped, halfDurationSecs);
    
    // Capped version for boundary detection
    const rawElapsed = rawElapsedCapped;
    // Cap elapsed at half duration - if we're past it, the client is at half-time/full-time
    // and hasn't transitioned yet. Don't let the elapsed overshoot.
    const currentElapsed = Math.min(rawElapsed, halfDurationSecs);
    const currentHalf = timerState.currentHalf;

    // Detect half-time boundary: elapsed has reached/exceeded half duration
    // This works whether timer is running (extrapolated) or paused (elapsedSeconds already at boundary)
    const isAtHalfTimeBoundaryClassic = timerState.currentHalf === 1 && rawElapsed >= halfDurationSecs;
    // Also detect halftime when the client has already transitioned to half 2:
    // The client syncs currentHalf=2, elapsedSeconds=0, isRunning=false immediately at halftime.
    // If the cron's 10s cycle missed the narrow half=1 boundary window, this catches it.
    const isAtHalfTimeBreakState = timerState.currentHalf === 2 && timerState.elapsedSeconds === 0 && !timerState.isRunning;
    const isAtHalfTimeBoundary = isAtHalfTimeBoundaryClassic || isAtHalfTimeBreakState;
    const isAtFullTimeBoundary = timerState.currentHalf === 2 && rawElapsed >= halfDurationSecs;

    // Skip stale games - if the DB row hasn't been updated recently,
    // the client has stopped syncing and this game is abandoned.
    // Use game.updated_at (set by client sync every 10s) NOT timerState.lastUpdateTime
    // (which is a frozen snapshot from when the timer was last interacted with).
    // Use a generous threshold — mobile apps (Capacitor WebViews) aggressively throttle
    // or freeze JS timers when backgrounded, so heartbeats can be delayed significantly.
    // The server extrapolates elapsed time from lastUpdateTime, so a longer stale window
    // doesn't affect notification accuracy — it just delays cleanup of truly abandoned games.
    const STALE_THRESHOLD_MS = (isAtHalfTimeBoundary || isAtFullTimeBoundary) ? 600_000 : 900_000; // 10min at breaks, 15min normally
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
      // Atomically claim the half-time notification slot to prevent duplicates
      // from concurrent cron invocations. Only the first invocation to update wins.
      const halfTimeMarker = game.last_sub_check_time ?? null;
      if (halfTimeMarker === null || halfTimeMarker < halfDurationSecs) {
        // Use separate filter conditions instead of .or() which can silently fail
        let claimResult: any[] | null = null;
        let claimError: any = null;

        if (halfTimeMarker === null || halfTimeMarker === undefined) {
          const result = await supabase
            .from('active_games')
            .update({ last_sub_check_time: halfDurationSecs })
            .eq('id', game.id)
            .is('last_sub_check_time', null)
            .select('id');
          claimResult = result.data;
          claimError = result.error;
        } else {
          const result = await supabase
            .from('active_games')
            .update({ last_sub_check_time: halfDurationSecs })
            .eq('id', game.id)
            .lt('last_sub_check_time', halfDurationSecs)
            .select('id');
          claimResult = result.data;
          claimError = result.error;
        }

        if (claimError) {
          console.error(`[CHECK-SUBS] Half time claim error for game ${game.id}:`, claimError.message);
        }
        
        // Only send notification if WE claimed it (update affected a row)
        if (!claimError && claimResult && claimResult.length > 0) {
          const teamId = game.team_id || timerState.teamId;
          const teamName = timerState.teamName || 'Your team';
          const linkedEventId = pitchState.linkedEventId;

          // Extra dedup safety: check if a half_time notification was already sent
          // for this user in the last 30 minutes (covers race conditions across
          // concurrent cron invocations or duplicate active_games rows)
          const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const { data: recentHalfTimeNotifs } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', game.user_id)
            .eq('type', 'half_time')
            .gte('created_at', thirtyMinAgo)
            .limit(1);

          if (recentHalfTimeNotifs && recentHalfTimeNotifs.length > 0) {
            console.log(`[CHECK-SUBS] Game ${game.id}: Halftime notification already sent recently, skipping`);
          } else {
            const staffUserIds = await getTeamStaffUserIds(supabase, teamId, linkedEventId);

            notificationsSent += await notifyTeamStaff(
              supabase, staffUserIds, game.user_id, game.id,
              teamId || undefined, teamName, linkedEventId,
              'half_time', `⏸️ ${teamName} - Half Time!`, 'half_time',
              `⏸️ Half Time!`, `${teamName} - Half Time`,
              undefined, undefined, undefined, timerState.minutesPerHalf, 1
            );

            console.log(`[CHECK-SUBS] Half time notification sent for game ${game.id} (team ${teamId})`);
          }
        } else if (claimResult && claimResult.length === 0) {
          console.log(`[CHECK-SUBS] Half time already claimed by another invocation for game ${game.id}`);
        }
      }
      continue; // Skip sub processing during half-time
    }
    const teamId = game.team_id || timerState.teamId;
    const teamName = timerState.teamName || 'Your team';
    const linkedEventId = pitchState.linkedEventId;

    // Get team staff (coaches + team_admins) for this specific team
    const staffUserIds = await getTeamStaffUserIds(supabase, teamId, linkedEventId);

    // Only process substitution notifications if auto-sub is active AND timer is running
    if (hasAutoSub && timerState.isRunning) {
      const getAbsoluteSubTime = (sub: SubstitutionEvent) => {
        return sub.half === 1 ? sub.time : halfDurationSecs + sub.time;
      };

      // Find ALL unexecuted subs for current half that are due (removed overdue skip - always notify)
      const allDueSubs = pitchState.autoSubPlan.filter((sub: SubstitutionEvent) => {
        const absoluteSubTime = getAbsoluteSubTime(sub);
        return !sub.executed &&
          sub.half === currentHalf &&
          currentElapsedForSubs >= sub.time &&
          absoluteSubTime > (game.last_sub_check_time || 0);
      });

      if (allDueSubs.length > 0) {
        // Group by time to find concurrent subs (batch)
        const dueTimes = [...new Set(allDueSubs.map((s: SubstitutionEvent) => s.time))].sort((a: number, b: number) => a - b);
        const earliestTime = dueTimes[0];
        const batchSubs = allDueSubs.filter((s: SubstitutionEvent) => s.time === earliestTime);
        
        const elapsedMinutes = Math.floor(currentElapsedForSubs / 60);
        const overdueSeconds = Math.floor(currentElapsedForSubs - earliestTime);

        let notificationBody: string;
        let pushTitle: string;
        let playerOutName: string | undefined;
        let playerInName: string | undefined;
        let position: string | undefined;

        if (batchSubs.length === 1) {
          const sub = batchSubs[0];
          playerOutName = sub.playerOut.name || `#${sub.playerOut.number}`;
          playerInName = sub.playerIn.name || `#${sub.playerIn.number}`;
          position = sub.playerOut.currentPitchPosition || 'Pitch';
          notificationBody = `${playerOutName} → Bench. ${playerInName} → ${position}`;
          pushTitle = `🔄 ${teamName} - Sub Due!`;
        } else {
          const subDescriptions = batchSubs.map((sub: SubstitutionEvent) => {
            const outName = sub.playerOut.name || `#${sub.playerOut.number}`;
            const inName = sub.playerIn.name || `#${sub.playerIn.number}`;
            const pos = sub.playerOut.currentPitchPosition || 'Pitch';
            return `${outName} → Bench, ${inName} → ${pos}`;
          });
          notificationBody = `${batchSubs.length} subs due: ${subDescriptions.join(' • ')}`;
          pushTitle = `🔄 ${teamName} - ${batchSubs.length} Subs Due!`;
          playerOutName = batchSubs[0].playerOut.name || `#${batchSubs[0].playerOut.number}`;
          playerInName = batchSubs[0].playerIn.name || `#${batchSubs[0].playerIn.number}`;
          position = batchSubs[0].playerOut.currentPitchPosition || 'Pitch';
        }

        // Atomically claim this sub time slot before sending notifications
        const maxAbsTime = Math.max(...batchSubs.map((s: SubstitutionEvent) => getAbsoluteSubTime(s)));
        const currentCheckTime = game.last_sub_check_time ?? null;
        
        // Use separate filter conditions instead of .or() which can silently fail with .update()
        let claimResult: any[] | null = null;
        let claimError: any = null;

        if (currentCheckTime === null || currentCheckTime === undefined) {
          const result = await supabase
            .from('active_games')
            .update({ last_sub_check_time: maxAbsTime })
            .eq('id', game.id)
            .is('last_sub_check_time', null)
            .select('id');
          claimResult = result.data;
          claimError = result.error;
        } else if (currentCheckTime < maxAbsTime) {
          const result = await supabase
            .from('active_games')
            .update({ last_sub_check_time: maxAbsTime })
            .eq('id', game.id)
            .lt('last_sub_check_time', maxAbsTime)
            .select('id');
          claimResult = result.data;
          claimError = result.error;
        }

        if (claimError) {
          console.error(`[CHECK-SUBS] Game ${game.id}: Claim error for sub at ${earliestTime}s:`, claimError.message);
        }
        
        if (claimResult && claimResult.length > 0) {
          console.log(`[CHECK-SUBS] Game ${game.id}: ${batchSubs.length} sub(s) due at ${earliestTime}s (overdue ${overdueSeconds}s), current=${Math.floor(currentElapsed)}s, claiming absTime=${maxAbsTime}`);

          const sent = await notifyTeamStaff(
            supabase, staffUserIds, game.user_id, game.id,
            teamId, teamName, linkedEventId,
            'pending_sub', notificationBody, 'pending_sub',
            pushTitle, notificationBody,
            playerOutName, playerInName, position, elapsedMinutes, currentHalf
          );
          console.log(`[CHECK-SUBS] Game ${game.id}: notifyTeamStaff sent=${sent} (staff=${staffUserIds.length}, owner=${game.user_id})`);
          notificationsSent += sent;
        } else if (!claimError) {
          console.log(`[CHECK-SUBS] Game ${game.id}: Sub at ${earliestTime}s already claimed (last_sub_check_time=${currentCheckTime}, target=${maxAbsTime})`);
        }
      }
    }

    // Check for game finished — use atomic claim to prevent duplicate full-time notifications
    // Use rawElapsed (not capped currentElapsed) for consistency with halftime boundary check.
    // currentElapsed is capped at halfDurationSecs, so `currentElapsed >= halfDurationSecs`
    // would always be true when rawElapsed >= halfDurationSecs, but using rawElapsed makes
    // the intent explicit and consistent with isAtFullTimeBoundary.
    const isGameFinished = isAtFullTimeBoundary;

    if (isGameFinished) {
      // Atomically claim by marking inactive — only the winner sends notifications
      const { data: claimResult, error: claimError } = await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', game.id)
        .eq('is_active', true)
        .select('id');
      
      if (!claimError && claimResult && claimResult.length > 0) {
        console.log(`[CHECK-SUBS] Game ${game.id} finished — claimed full-time notification`);
        const fullTimeMessage = `🏆 ${teamName} - Full Time!`;
        notificationsSent += await notifyTeamStaff(
          supabase, staffUserIds, game.user_id, game.id,
          teamId, teamName, linkedEventId,
          'full_time', fullTimeMessage, 'game_finished',
          `🏆 Full Time!`, `${teamName} - Full Time`,
          undefined, undefined, undefined, timerState.minutesPerHalf * 2, 2
        );
      } else {
        console.log(`[CHECK-SUBS] Game ${game.id} full-time already claimed by another invocation`);
      }
    }
  }

  return notificationsSent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Client-triggered calls: run a single check and return immediately.
  // Background cron calls: loop for ~55s checking every 10s.
  let isClientTriggered = false;
  try {
    const body = await req.json().catch(() => null);
    if (body?.source && typeof body.source === 'string' && body.source.startsWith('client-')) {
      isClientTriggered = true;
    }
  } catch { /* no body = cron */ }

  if (isClientTriggered) {
    console.log('[CHECK-SUBS] Client-triggered — single check');
    const notifications = await checkGames(supabase);
    console.log(`[CHECK-SUBS] Client check complete: ${notifications} notification(s)`);
    return new Response(JSON.stringify({
      message: 'Client check complete',
      checksPerformed: 1,
      totalNotifications: notifications
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[CHECK-SUBS] Starting - will check every 10s for ~55s');

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
