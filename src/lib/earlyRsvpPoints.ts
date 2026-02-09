import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, parseISO } from "date-fns";
import { recordPointsHistory } from "@/lib/pointsHistory";

const EARLY_RSVP_DAYS_THRESHOLD = 3;
const EARLY_RSVP_POINTS = 1;

interface AwardEarlyRsvpPointsParams {
  userId: string;
  eventDate: string;
  rsvpId: string;
  clubId: string;
  clubName: string;
}

/**
 * Awards 1 Ignite point to a user if they RSVP "going" at least 3 days before the event.
 * Returns true if points were awarded, false otherwise.
 */
export async function awardEarlyRsvpPoints({
  userId,
  eventDate,
  rsvpId,
  clubId,
  clubName,
}: AwardEarlyRsvpPointsParams): Promise<boolean> {
  try {
    // Check if event is at least 3 days away
    const eventDateParsed = parseISO(eventDate);
    const now = new Date();
    const daysUntilEvent = differenceInDays(eventDateParsed, now);

    if (daysUntilEvent < EARLY_RSVP_DAYS_THRESHOLD) {
      return false;
    }

    // Check if points were already awarded for this RSVP
    const { data: rsvp } = await supabase
      .from("rsvps")
      .select("early_rsvp_points_awarded")
      .eq("id", rsvpId)
      .single();

    if (rsvp?.early_rsvp_points_awarded) {
      return false;
    }

    // Get current points
    const { data: profile } = await supabase
      .from("profiles")
      .select("ignite_points")
      .eq("id", userId)
      .single();

    const currentPoints = profile?.ignite_points || 0;
    const newPoints = currentPoints + EARLY_RSVP_POINTS;

    // Award points
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ ignite_points: newPoints })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to award early RSVP points:", updateError);
      return false;
    }

    // Record in points history
    await recordPointsHistory({
      userId,
      clubId,
      amount: EARLY_RSVP_POINTS,
      balanceAfter: newPoints,
      sourceType: 'early_rsvp',
      sourceId: rsvpId,
      description: `Early RSVP bonus (${daysUntilEvent} days before event)`,
    });

    // Mark RSVP as having awarded points
    await supabase
      .from("rsvps")
      .update({ early_rsvp_points_awarded: true })
      .eq("id", rsvpId);

    // Create notification
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "points_awarded",
      message: `+${EARLY_RSVP_POINTS} Ignite point for early RSVP! (${daysUntilEvent} days before event)`,
      related_id: clubId,
    });

    // Send email notification (fire and forget)
    supabase.functions.invoke("send-points-notification-email", {
      body: {
        recipientUserId: userId,
        pointsAwarded: EARLY_RSVP_POINTS,
        reason: "Early RSVP bonus",
        totalPoints: newPoints,
        clubName,
        rewardUnlocked: false,
      },
    }).catch((err) => console.error("Failed to send points email:", err));

    return true;
  } catch (error) {
    console.error("Error in awardEarlyRsvpPoints:", error);
    return false;
  }
}
