import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Send engagement reminder push notifications to Pro club users
 * who have 5+ combined unread messages and unseen photos.
 * 
 * Runs on a schedule. Enforces a 2-day cooldown per user.
 * Only targets users in clubs with active Pro subscriptions.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await isAuthorizedCronCaller(req))) {
    console.error("Unauthorized: caller is not an authorized cron/internal caller");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    console.log("[EngagementReminder] Starting engagement reminder check...");

    // 1. Get all Pro club IDs
    const { data: proClubs, error: proErr } = await supabase
      .from("club_subscriptions")
      .select("club_id, disable_points_system")
      .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

    if (proErr) {
      console.error("[EngagementReminder] Error fetching pro clubs:", proErr);
      throw proErr;
    }

    if (!proClubs || proClubs.length === 0) {
      console.log("[EngagementReminder] No Pro clubs found");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const proClubIds = proClubs.map(c => c.club_id);
    console.log(`[EngagementReminder] Found ${proClubIds.length} Pro club(s)`);

    // 2. Get all teams in Pro clubs
    const { data: proTeams } = await supabase
      .from("teams")
      .select("id, club_id")
      .in("club_id", proClubIds);

    if (!proTeams || proTeams.length === 0) {
      console.log("[EngagementReminder] No teams in Pro clubs");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const proTeamIds = proTeams.map(t => t.id);
    const teamToClub: Record<string, string> = {};
    for (const t of proTeams) {
      teamToClub[t.id] = t.club_id;
    }

    // 3. Get users in Pro teams (via user_roles)
    const { data: teamMembers } = await supabase
      .from("user_roles")
      .select("user_id, team_id")
      .in("team_id", proTeamIds)
      .not("user_id", "is", null);

    if (!teamMembers || teamMembers.length === 0) {
      console.log("[EngagementReminder] No members in Pro teams");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Build user -> teams map
    const userTeams: Record<string, string[]> = {};
    for (const m of teamMembers) {
      if (!m.user_id) continue;
      if (!userTeams[m.user_id]) userTeams[m.user_id] = [];
      if (!userTeams[m.user_id].includes(m.team_id!)) {
        userTeams[m.user_id].push(m.team_id!);
      }
    }

    const uniqueUserIds = Object.keys(userTeams);
    console.log(`[EngagementReminder] ${uniqueUserIds.length} unique users in Pro teams`);

    // 4. Filter out users who received a reminder in last 2 days
    const { data: recentReminders } = await supabase
      .from("engagement_reminder_log")
      .select("user_id")
      .gte("sent_at", twoDaysAgo);

    const recentlyReminded = new Set((recentReminders || []).map(r => r.user_id));
    let eligibleUsers = uniqueUserIds.filter(uid => !recentlyReminded.has(uid));
    console.log(`[EngagementReminder] ${eligibleUsers.length} eligible (after cooldown filter)`);

    // 4b. Filter out users who have disabled rewards/points notifications
    if (eligibleUsers.length > 0) {
      const { data: disabledPrefs } = await supabase
        .from("notification_preferences")
        .select("user_id")
        .in("user_id", eligibleUsers)
        .eq("rewards_enabled", false);

      if (disabledPrefs && disabledPrefs.length > 0) {
        const disabledSet = new Set(disabledPrefs.map(p => p.user_id));
        eligibleUsers = eligibleUsers.filter(uid => !disabledSet.has(uid));
        console.log(`[EngagementReminder] ${disabledPrefs.length} users opted out of points notifications, ${eligibleUsers.length} remaining`);
      }
    }

    if (eligibleUsers.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: "all on cooldown or opted out" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 5. Get recent team messages (last 7 days) for Pro teams
    const { data: recentMessages } = await supabase
      .from("team_messages")
      .select("id, team_id, author_id")
      .in("team_id", proTeamIds)
      .gte("created_at", sevenDaysAgo)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000);

    // 6. Get message reads for eligible users
    const { data: messageReads } = await supabase
      .from("message_reads")
      .select("user_id, team_message_id")
      .in("user_id", eligibleUsers)
      .not("team_message_id", "is", null);

    const readMessageSet = new Set(
      (messageReads || []).map(r => `${r.user_id}:${r.team_message_id}`)
    );

    // 7. Get recent photos (last 7 days) in Pro teams
    const { data: recentPhotos } = await supabase
      .from("photos")
      .select("id, team_id, uploader_id")
      .in("team_id", proTeamIds)
      .gte("created_at", sevenDaysAgo)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(2000);

    // 8. Get photo reactions for eligible users (as a proxy for "seen")
    const { data: photoReactions } = await supabase
      .from("photo_reactions")
      .select("user_id, photo_id")
      .in("user_id", eligibleUsers);

    const reactedPhotoSet = new Set(
      (photoReactions || []).map(r => `${r.user_id}:${r.photo_id}`)
    );

    // 9. Calculate unread counts per eligible user and send notifications
    let totalSent = 0;
    const notifications: Array<{ user_id: string; type: string; message: string }> = [];
    const logEntries: Array<{ user_id: string; unread_messages_count: number; unread_photos_count: number }> = [];

    // Get club points display names
    const clubPointsNames: Record<string, string> = {};
    for (const c of proClubs) {
      clubPointsNames[c.club_id] = 'reward points'; // default
    }
    const { data: clubData } = await supabase
      .from("clubs")
      .select("id, points_display_name")
      .in("id", proClubIds);
    for (const c of (clubData || [])) {
      if (c.points_display_name) clubPointsNames[c.id] = c.points_display_name;
    }

    for (const userId of eligibleUsers) {
      const userTeamIds = userTeams[userId];
      
      // Count unread team messages (exclude own messages)
      const unreadMessages = (recentMessages || []).filter(m => 
        userTeamIds.includes(m.team_id) &&
        m.author_id !== userId &&
        !readMessageSet.has(`${userId}:${m.id}`)
      ).length;

      // Count unseen photos (exclude own uploads, not reacted to)
      const unseenPhotos = (recentPhotos || []).filter(p =>
        userTeamIds.includes(p.team_id!) &&
        p.uploader_id !== userId &&
        !reactedPhotoSet.has(`${userId}:${p.id}`)
      ).length;

      const totalUnread = unreadMessages + unseenPhotos;

      if (totalUnread < 5) continue;

      // Build message
      const parts: string[] = [];
      if (unreadMessages > 0) parts.push(`${unreadMessages} unread message${unreadMessages > 1 ? 's' : ''}`);
      if (unseenPhotos > 0) parts.push(`${unseenPhotos} new photo${unseenPhotos > 1 ? 's' : ''}`);

      // Get club for this user's first team
      const clubId = teamToClub[userTeamIds[0]];
      const pointsName = clubPointsNames[clubId] || 'reward points';
      const pointsDisabled = proClubs.find(c => c.club_id === clubId)?.disable_points_system;

      const engagementText = parts.join(' and ');
      const rewardsText = pointsDisabled ? '' : ` Engage to earn ${pointsName}! 🏆`;
      const message = `📬 You have ${engagementText}.${rewardsText}`;

      notifications.push({
        user_id: userId,
        type: "engagement_reminder",
        message,
      });

      logEntries.push({
        user_id: userId,
        unread_messages_count: unreadMessages,
        unread_photos_count: unseenPhotos,
      });
    }

    // Batch insert notifications
    if (notifications.length > 0) {
      // Insert in batches of 500
      for (let i = 0; i < notifications.length; i += 500) {
        const batch = notifications.slice(i, i + 500);
        const { error: notifErr } = await supabase
          .from("notifications")
          .insert(batch);
        if (notifErr) {
          console.error("[EngagementReminder] Error inserting notifications:", notifErr);
        } else {
          totalSent += batch.length;
        }
      }

      // Log cooldowns
      for (let i = 0; i < logEntries.length; i += 500) {
        const batch = logEntries.slice(i, i + 500);
        await supabase.from("engagement_reminder_log").insert(batch);
      }
    }

    console.log(`[EngagementReminder] COMPLETE: Sent ${totalSent} engagement reminders`);

    return new Response(
      JSON.stringify({ success: true, sent: totalSent, eligible: eligibleUsers.length }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("[EngagementReminder] FATAL:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
