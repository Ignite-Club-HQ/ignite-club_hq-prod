import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

/**
 * Weekly Engagement Digest
 * 
 * Runs once per week (e.g. Sunday evening). For each user who earned engagement
 * points in the past 7 days, sends a single summary notification with:
 * - Total engagement points earned
 * - Breakdown by type (chat, photos, comments)
 * - Encouragement / next-step nudge
 */
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

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get all engagement points from the past week, grouped by user
    const { data: weeklyPoints, error } = await supabase
      .from('points_history')
      .select('user_id, amount, source_type')
      .in('source_type', ['chat_engagement', 'photo_upload', 'photo_comment'])
      .gte('created_at', sevenDaysAgo)
      .not('user_id', 'is', null);

    if (error) {
      console.error('Failed to fetch weekly points:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch points' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!weeklyPoints || weeklyPoints.length === 0) {
      console.log('No engagement points earned this week');
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by user
    const userMap = new Map<string, { chat: number; photo: number; comment: number; total: number }>();

    for (const entry of weeklyPoints) {
      if (!entry.user_id) continue;
      const existing = userMap.get(entry.user_id) || { chat: 0, photo: 0, comment: 0, total: 0 };
      existing.total += entry.amount;

      if (entry.source_type === 'chat_engagement') existing.chat += entry.amount;
      else if (entry.source_type === 'photo_upload') existing.photo += entry.amount;
      else if (entry.source_type === 'photo_comment') existing.comment += entry.amount;

      userMap.set(entry.user_id, existing);
    }

    let notificationCount = 0;
    const notifications = [];

    for (const [userId, stats] of userMap) {
      const parts: string[] = [];
      if (stats.chat > 0) parts.push(`💬 ${stats.chat} from chat`);
      if (stats.photo > 0) parts.push(`📸 ${stats.photo} from photos`);
      if (stats.comment > 0) parts.push(`💭 ${stats.comment} from comments`);

      const breakdown = parts.join(', ');
      
      // Pick a nudge based on what they're NOT doing much of
      let nudge = '';
      if (stats.photo === 0) {
        nudge = ' Upload a photo this week for bonus points! 📷';
      } else if (stats.chat === 0) {
        nudge = ' Join the team chat for easy points! 💬';
      } else if (stats.comment === 0) {
        nudge = " Comment on your team's photos for extra points! 💭";
      } else {
        nudge = ' Keep it up — you\'re on fire! 🔥';
      }

      notifications.push({
        user_id: userId,
        type: 'weekly_engagement_digest',
        message: `📊 Weekly points recap: +${stats.total} reward points! ${breakdown}.${nudge}`,
      });
      notificationCount++;
    }

    // Batch insert notifications (chunks of 500)
    for (let i = 0; i < notifications.length; i += 500) {
      const chunk = notifications.slice(i, i + 500);
      const { error: insertError } = await supabase.from('notifications').insert(chunk);
      if (insertError) {
        console.error(`Failed to insert notification batch ${i}:`, insertError);
      }
    }

    console.log(`Weekly engagement digest sent to ${notificationCount} users`);

    return new Response(
      JSON.stringify({ processed: notificationCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Weekly engagement digest error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
