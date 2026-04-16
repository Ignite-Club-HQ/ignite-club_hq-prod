import { supabase } from "@/integrations/supabase/client";
import { recordPointsHistory, type PointsSourceType } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";

/**
 * Engagement Points System
 * 
 * Awards points for active app usage with daily cooldowns:
 * - Chat message (team/club/group): 1 pt per unique chat per day, max 2/day
 * - Photo upload: 2 pts per upload, max 4 pts/day (2 uploads)
 * - Photo comment: 1 pt per unique photo per day, max 3/day
 */

type EngagementAction = 'chat_message' | 'photo_upload' | 'photo_comment';

const ACTION_CONFIG: Record<EngagementAction, { points: number; dailyCap: number }> = {
  chat_message: { points: 1, dailyCap: 2 },
  photo_upload: { points: 2, dailyCap: 4 },
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
 * Awards engagement points with atomic cooldown checks and point increments.
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

    // Atomic cooldown check + insert via DB function
    const { data: cooldownOk, error: cooldownError } = await supabase.rpc('try_insert_points_cooldown', {
      _user_id: userId,
      _action_type: action,
      _scope_id: scopeId,
      _awarded_date: today,
      _points_awarded: config.points,
      _club_id: clubId,
      _daily_cap: config.dailyCap,
    });

    if (cooldownError || !cooldownOk) {
      return false; // Already awarded or daily cap reached
    }

    // Atomic points increment
    const { data: newPoints, error: updateError } = await supabase.rpc('increment_ignite_points', {
      _user_id: userId,
      _amount: config.points,
    });

    if (updateError) {
      console.error("Failed to award engagement points:", updateError);
      return false;
    }

    const balanceAfter = newPoints || 0;
    const previousPoints = balanceAfter - config.points;

    // Record in points history
    await recordPointsHistory({
      userId,
      clubId,
      amount: config.points,
      balanceAfter,
      sourceType: SOURCE_TYPE_MAP[action],
      sourceId: sourceId || scopeId,
      description: DESCRIPTION_MAP[action],
    });

    // Create notification so user gets a push
    const NOTIFICATION_MAP: Record<EngagementAction, string> = {
      chat_message: `⭐ +${config.points} reward point for chat engagement!`,
      photo_upload: `📸 +${config.points} reward points for uploading a photo!`,
      photo_comment: `💬 +${config.points} reward point for commenting on a photo!`,
    };

    supabase.from("notifications").insert({
      user_id: userId,
      type: "points_awarded",
      message: NOTIFICATION_MAP[action],
      related_id: clubId,
    }).then(({ error }) => {
      if (error) console.error("Failed to create engagement points notification:", error);
    });

    // Check reward threshold (fire and forget)
    checkRewardThreshold({
      userId,
      clubId,
      previousPoints,
      newPoints: balanceAfter,
    }).catch(() => {});

    return true;
  } catch (error) {
    console.error("Error in awardEngagementPoints:", error);
    return false;
  }
}
