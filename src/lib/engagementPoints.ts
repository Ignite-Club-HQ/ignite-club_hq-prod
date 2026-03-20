import { supabase } from "@/integrations/supabase/client";
import { recordPointsHistory, type PointsSourceType } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";

/**
 * Engagement Points System
 * 
 * Awards points for active app usage with daily cooldowns:
 * - Chat message (team/club/group): 1 pt per unique chat per day, max 3/day
 * - Photo upload: 2 pts per upload, max 4 pts/day (2 uploads)
 * - Photo comment: 1 pt per unique photo per day, max 3/day
 */

type EngagementAction = 'chat_message' | 'photo_upload' | 'photo_comment';

const ACTION_CONFIG: Record<EngagementAction, { points: number; dailyCap: number }> = {
  chat_message: { points: 1, dailyCap: 2 },
  photo_upload: { points: 2, dailyCap: 4 },   // 4 pts = 2 uploads max
  photo_comment: { points: 1, dailyCap: 3 },
};

const SOURCE_TYPE_MAP: Record<EngagementAction, PointsSourceType> = {
  chat_message: 'chat_engagement',
  photo_upload: 'photo_upload',
  photo_comment: 'photo_comment',
};

const DESCRIPTION_MAP: Record<EngagementAction, string> = {
  chat_message: 'Chat engagement bonus',
  photo_upload: 'Photo upload bonus',
  photo_comment: 'Photo comment bonus',
};

interface AwardEngagementPointsParams {
  userId: string;
  clubId: string;
  action: EngagementAction;
  /** Scope ID for cooldown dedup (e.g. team_id, group_id, club_id for chat; photo_id for comments) */
  scopeId: string;
  sourceId?: string;
}

/**
 * Awards engagement points with daily cooldown checks.
 * Fire-and-forget — call without awaiting in non-critical paths.
 */
export async function awardEngagementPoints({
  userId,
  clubId,
  action,
  scopeId,
  sourceId,
}: AwardEngagementPointsParams): Promise<boolean> {
  try {
    const config = ACTION_CONFIG[action];
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if club has Pro subscription and points system enabled
    const { data: clubSub } = await supabase
      .from("club_subscriptions")
      .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, disable_points_system")
      .eq("club_id", clubId)
      .maybeSingle();

    const hasPro = clubSub?.is_pro || clubSub?.is_pro_football ||
                   clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;

    if (!hasPro || clubSub?.disable_points_system) {
      return false;
    }

    // Check cooldown: has this user already been awarded for this action+scope today?
    // Using rpc or raw query since points_cooldowns isn't in generated types yet
    const { data: existingCooldown } = await (supabase as any)
      .from("points_cooldowns")
      .select("id")
      .eq("user_id", userId)
      .eq("action_type", action)
      .eq("scope_id", scopeId)
      .eq("awarded_date", today)
      .maybeSingle();

    if (existingCooldown) {
      return false; // Already awarded for this scope today
    }

    // Check daily cap: total points awarded for this action type today
    const { data: todayEntries } = await (supabase as any)
      .from("points_cooldowns")
      .select("points_awarded")
      .eq("user_id", userId)
      .eq("action_type", action)
      .eq("awarded_date", today);

    const totalTodayPoints = (todayEntries || []).reduce(
      (sum: number, e: { points_awarded: number }) => sum + (e.points_awarded || 0),
      0
    );

    if (totalTodayPoints >= config.dailyCap) {
      return false; // Daily cap reached
    }

    // Get current points
    const { data: profile } = await supabase
      .from("profiles")
      .select("ignite_points")
      .eq("id", userId)
      .single();

    const currentPoints = profile?.ignite_points || 0;
    const newPoints = currentPoints + config.points;

    // Award points
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ ignite_points: newPoints })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to award engagement points:", updateError);
      return false;
    }

    // Record cooldown
    await (supabase as any).from("points_cooldowns").insert({
      user_id: userId,
      action_type: action,
      scope_id: scopeId,
      awarded_date: today,
      points_awarded: config.points,
      club_id: clubId,
    });

    // Record in points history
    await recordPointsHistory({
      userId,
      clubId,
      amount: config.points,
      balanceAfter: newPoints,
      sourceType: SOURCE_TYPE_MAP[action],
      sourceId: sourceId || scopeId,
      description: DESCRIPTION_MAP[action],
    });

    // Check reward threshold (fire and forget)
    checkRewardThreshold({
      userId,
      clubId,
      previousPoints: currentPoints,
      newPoints,
    }).catch(() => {});

    return true;
  } catch (error) {
    console.error("Error in awardEngagementPoints:", error);
    return false;
  }
}
