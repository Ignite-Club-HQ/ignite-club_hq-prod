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
}

interface Player {
  id: string;
  name: string;
  number: number;
  position?: { x: number; y: number };
  isOnPitch: boolean;
  playTime: number;
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
}

const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
const TOTAL_DURATION_MS = 55000; // Run for 55 seconds (leave 5s buffer before next cron)

async function checkGames(supabase: any): Promise<number> {
  // Get all active games
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

    // Calculate current elapsed time
    const now = Date.now();
    const timeSinceLastUpdate = Math.floor((now - timerState.lastUpdateTime) / 1000);
    const currentElapsed = timerState.elapsedSeconds + (timerState.isRunning ? timeSinceLastUpdate : 0);
    const currentHalf = timerState.currentHalf;
    const halfDurationSecs = timerState.minutesPerHalf * 60;
    
    // Calculate absolute time for comparison (sub.time is relative to half start)
    const getAbsoluteSubTime = (sub: SubstitutionEvent) => {
      return sub.half === 1 ? sub.time : halfDurationSecs + sub.time;
    };
    
    // Current absolute time
    const currentAbsoluteTime = currentHalf === 1 ? currentElapsed : halfDurationSecs + currentElapsed;

    // Find next unexecuted sub for current half that's due
    // Compare absolute times to handle half transitions correctly
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
      const position = (nextSub.playerOut as any).currentPitchPosition || 'Pitch';
      const notificationBody = `${playerOutName} → Bench. ${playerInName} → ${position}`;

      console.log(`[CHECK-SUBS] Game ${game.id}: Sub due at ${nextSub.time}s, current=${currentElapsed}s`);

      // Check user's notification preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('pitch_board_enabled')
        .eq('user_id', game.user_id)
        .single();

      if (prefs?.pitch_board_enabled === false) continue;

      // Create notification
      const { error: notifError, data: notifData } = await supabase
        .from('notifications')
        .insert({
          user_id: game.user_id,
          type: 'pending_sub',
          message: notificationBody,
          related_id: game.id,
        })
        .select()
        .single();

      if (notifError) {
        console.error(`[CHECK-SUBS] Failed to create notification:`, notifError.message);
      } else {
        notificationsSent++;
        console.log(`[CHECK-SUBS] Notification created: ${notifData?.id} for user ${game.user_id}`);
      }

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

    // Check for game finished
    const isGameFinished = timerState.currentHalf === 2 && currentElapsed >= halfDurationSecs;

    if (isGameFinished) {
      console.log(`[CHECK-SUBS] Game ${game.id} finished`);

      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('pitch_board_enabled')
        .eq('user_id', game.user_id)
        .single();

      if (prefs?.pitch_board_enabled !== false) {
        const teamName = timerState.teamName || 'Your team';
        
        await supabase
          .from('notifications')
          .insert({
            user_id: game.user_id,
            type: 'game_finished',
            message: `🏆 ${teamName} - Full Time!`,
            related_id: game.id,
          });
        notificationsSent++;
      }

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

  // Run checks every 10 seconds for ~55 seconds
  while (Date.now() - startTime < TOTAL_DURATION_MS) {
    checksPerformed++;
    const notifications = await checkGames(supabase);
    totalNotifications += notifications;
    
    if (notifications > 0) {
      console.log(`[CHECK-SUBS] Check #${checksPerformed}: sent ${notifications} notification(s)`);
    }

    // Wait 10 seconds before next check (unless we're about to exceed duration)
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
