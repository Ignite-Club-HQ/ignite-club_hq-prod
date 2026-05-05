import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Weekly Engagement Bonus Edge Function
 * 
 * Awards bonus points for weekly streaks:
 * - Active in chat 5+ unique days in a week → +3 bonus points
 * - Uploaded 3+ photos in a week → +2 bonus points
 * 
 * Should be scheduled to run weekly (e.g., every Monday at midnight).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate the date range for the previous week (Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysToLastMonday - 7);
    lastMonday.setHours(0, 0, 0, 0);
    
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    lastSunday.setHours(23, 59, 59, 999);

    const weekStart = lastMonday.toISOString().split('T')[0];
    const weekEnd = lastSunday.toISOString().split('T')[0];

    console.log(`Processing weekly engagement bonuses for ${weekStart} to ${weekEnd}`);

    // Get all cooldown entries for the past week
    const { data: weekEntries, error: fetchError } = await supabase
      .from('points_cooldowns')
      .select('user_id, action_type, awarded_date, club_id')
      .gte('awarded_date', weekStart)
      .lte('awarded_date', weekEnd);

    if (fetchError) {
      throw new Error(`Failed to fetch cooldowns: ${fetchError.message}`);
    }

    if (!weekEntries || weekEntries.length === 0) {
      console.log('No engagement activity found for the past week');
      return new Response(
        JSON.stringify({ success: true, bonuses_awarded: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by user_id
    const userActivity: Record<string, { 
      chatDays: Set<string>; 
      photoUploads: number;
      clubIds: Set<string>;
    }> = {};

    for (const entry of weekEntries) {
      if (!userActivity[entry.user_id]) {
        userActivity[entry.user_id] = { chatDays: new Set(), photoUploads: 0, clubIds: new Set() };
      }
      const ua = userActivity[entry.user_id];
      ua.clubIds.add(entry.club_id);

      if (entry.action_type === 'chat_message') {
        ua.chatDays.add(entry.awarded_date);
      } else if (entry.action_type === 'photo_upload') {
        ua.photoUploads++;
      }
    }

    let bonusesAwarded = 0;

    for (const [userId, activity] of Object.entries(userActivity)) {
      let totalBonus = 0;
      const reasons: string[] = [];

      // Chat streak: 5+ unique days
      if (activity.chatDays.size >= 5) {
        totalBonus += 3;
        reasons.push(`Chat streak (${activity.chatDays.size} days)`);
      }

      // Photo streak: 3+ uploads
      if (activity.photoUploads >= 3) {
        totalBonus += 2;
        reasons.push(`Photo streak (${activity.photoUploads} uploads)`);
      }

      if (totalBonus === 0) continue;

      // Check if bonus already awarded for this week
      const bonusScopeId = `weekly-bonus-${weekStart}`;
      const { data: existingBonus } = await supabase
        .from('points_cooldowns')
        .select('id')
        .eq('user_id', userId)
        .eq('action_type', 'weekly_bonus')
        .eq('scope_id', bonusScopeId)
        .maybeSingle();

      if (existingBonus) continue;

      // Pick the first club_id for the bonus record
      const clubId = [...activity.clubIds][0];

      // Check if this club has Pro + points enabled
      const { data: clubSub } = await supabase
        .from('club_subscriptions')
        .select('is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, disable_points_system')
        .eq('club_id', clubId)
        .maybeSingle();

      const hasPro = clubSub?.is_pro || clubSub?.is_pro_football ||
                     clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;

      if (!hasPro || clubSub?.disable_points_system) continue;

      // Atomic points increment
      const { data: newPointsResult, error: rpcError } = await supabase.rpc('increment_ignite_points', {
        _user_id: userId,
        _amount: totalBonus,
        _club_id: clubId,
      });

      if (rpcError) {
        console.error(`Failed to award weekly bonus to ${userId}:`, rpcError);
        continue;
      }

      const newPoints = newPointsResult || 0;

      // Record cooldown to prevent double-awarding
      await supabase.from('points_cooldowns').insert({
        user_id: userId,
        action_type: 'weekly_bonus',
        scope_id: bonusScopeId,
        awarded_date: weekEnd,
        points_awarded: totalBonus,
        club_id: clubId,
      });

      // Record in points history
      const sourceType = activity.chatDays.size >= 5 ? 'weekly_chat_streak' : 'weekly_photo_streak';
      await supabase.from('points_history').insert({
        user_id: userId,
        club_id: clubId,
        amount: totalBonus,
        balance_after: newPoints,
        source_type: sourceType,
        description: `Weekly engagement bonus: ${reasons.join(' + ')}`,
      });

      // Create notification
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'points_awarded',
        message: `🔥 Weekly engagement bonus! +${totalBonus} points for: ${reasons.join(', ')}`,
        related_id: clubId,
      });

      bonusesAwarded++;
      console.log(`Awarded ${totalBonus} weekly bonus points to user ${userId}: ${reasons.join(', ')}`);
    }

    console.log(`Weekly engagement bonuses complete. ${bonusesAwarded} users received bonuses.`);

    return new Response(
      JSON.stringify({ success: true, bonuses_awarded: bonusesAwarded }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in process-weekly-engagement-bonus:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
