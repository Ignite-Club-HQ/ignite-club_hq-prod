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
 *
 * Count correctness invariants (2026-08-11):
 *  - EVERY bulk read over a multi-user set is paginated. PostgREST caps rows at
 *    1,000 per request; an unpaginated read silently truncates and makes later
 *    users look like they have read nothing (inflated unread counts).
 *  - Unread messages are derived from the SAME source the in-app inbox badge
 *    uses (unread `notifications` rows of message types), so the push number
 *    matches what the user sees. `get_unread_message_counts` itself cannot be
 *    called here — it hard-requires `auth.uid() = _user_id` and rejects the
 *    service role — so we read its underlying notification rows directly.
 *  - "New photos" uses `photo_views` (actual views), never `photo_reactions`.
 *  - A sanity ceiling skips implausible counts instead of sending them.
 */

const PAGE_SIZE = 1000;
const UNREAD_SANITY_CEILING = 100;

/**
 * The ONLY notification types that `get_unread_message_counts` actually
 * aggregates into the in-app inbox badge (broadcast + teams + clubs + groups +
 * dms). `message_reply` and `message_mention` are deliberately absent: the RPC
 * reads them but never sums them, so counting them here would report a number
 * the user can never see in the app.
 */
const BADGE_COUNTED_NOTIFICATION_TYPES = [
  "team_message",
  "club_message",
  "group_message",
  "broadcast",
  "direct_message",
];

/** Fetch every row for a query, paginating past the PostgREST 1,000-row cap. */
async function fetchAllPages<T>(
  label: string,
  build: (offset: number, limit: number) => any,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  // Hard stop so a runaway query can never spin forever.
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build(offset, PAGE_SIZE).range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error(`[EngagementReminder] pagination error (${label}) at offset ${offset}:`, error);
      throw error;
    }
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
    offset += PAGE_SIZE;
  }
  // Returning partial rows here would reintroduce the exact silent-truncation
  // bug this helper exists to prevent, so fail the whole run instead.
  throw new Error(
    `[EngagementReminder] pagination cap reached for ${label} after ${rows.length} rows — aborting run rather than sending counts from a truncated read`
  );
}

/** Chunk a list of ids so `.in()` filters stay a sane size. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

    // 1. Get all Pro club IDs (paginated — a club count over 1,000 would
    //    otherwise silently truncate and drop whole clubs from the run)
    const proClubs = await fetchAllPages<{ club_id: string; disable_points_system: boolean | null }>(
      "club_subscriptions",
      () => supabase
        .from("club_subscriptions")
        .select("club_id, disable_points_system")
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true")
        .order("id"),
    );

    if (proClubs.length === 0) {
      console.log("[EngagementReminder] No Pro clubs found");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const proClubIds = proClubs.map(c => c.club_id);
    console.log(`[EngagementReminder] Found ${proClubIds.length} Pro club(s)`);


    // 2. Get all teams in Pro clubs (paginated + chunked, like every other
    //    `.in()` filter here, so the request URL can never blow out)
    const proTeams: Array<{ id: string; club_id: string }> = [];
    for (const clubIdChunk of chunk(proClubIds, 200)) {
      const rows = await fetchAllPages<{ id: string; club_id: string }>(
        "teams",
        () => supabase.from("teams").select("id, club_id").in("club_id", clubIdChunk).order("id"),
      );
      proTeams.push(...rows);
    }

    if (proTeams.length === 0) {
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

    // 3. Get users in Pro teams (via user_roles, paginated)
    const teamMembers: Array<{ user_id: string | null; team_id: string | null }> = [];
    for (const teamIdChunk of chunk(proTeamIds, 200)) {
      const rows = await fetchAllPages<{ user_id: string | null; team_id: string | null }>(
        "user_roles",
        () => supabase
          .from("user_roles")
          .select("user_id, team_id")
          .in("team_id", teamIdChunk)
          .not("user_id", "is", null)
          .order("id"),
      );
      teamMembers.push(...rows);
    }

    if (teamMembers.length === 0) {
      console.log("[EngagementReminder] No members in Pro teams");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Build user -> teams map
    const userTeams: Record<string, string[]> = {};
    for (const m of teamMembers) {
      if (!m.user_id || !m.team_id) continue;
      if (!userTeams[m.user_id]) userTeams[m.user_id] = [];
      if (!userTeams[m.user_id].includes(m.team_id)) {
        userTeams[m.user_id].push(m.team_id);
      }
    }

    const uniqueUserIds = Object.keys(userTeams);
    console.log(`[EngagementReminder] ${uniqueUserIds.length} unique users in Pro teams`);

    // 4. Filter out users who received a reminder in last 2 days (paginated)
    const recentReminders = await fetchAllPages<{ user_id: string }>(
      "engagement_reminder_log",
      () => supabase
        .from("engagement_reminder_log")
        .select("user_id")
        .gte("sent_at", twoDaysAgo)
        .order("id"),
    );

    const recentlyReminded = new Set(recentReminders.map(r => r.user_id));
    let eligibleUsers = uniqueUserIds.filter(uid => !recentlyReminded.has(uid));
    console.log(`[EngagementReminder] ${eligibleUsers.length} eligible (after cooldown filter)`);

    // 4b. Filter out users who have disabled rewards/points notifications (paginated)
    if (eligibleUsers.length > 0) {
      const disabledPrefs: Array<{ user_id: string }> = [];
      for (const userChunk of chunk(eligibleUsers, 200)) {
        const rows = await fetchAllPages<{ id: string; user_id: string }>(
          "notification_preferences",
          () => supabase
            .from("notification_preferences")
            .select("id, user_id")
            .in("user_id", userChunk)
            .eq("rewards_enabled", false)
            // Order by the unique id, never user_id — a non-unique sort key can
            // duplicate or drop rows across page boundaries.
            .order("id"),
        );
        disabledPrefs.push(...rows);
      }

      if (disabledPrefs.length > 0) {
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

    // 5. Unread messages: mirror `get_unread_message_counts` EXACTLY, because a
    //    flat count of unread message-type notification rows over-counts:
    //      - orphan rows whose `related_id` no longer resolves to a message
    //        (hard-deleted messages) are dropped by the badge's INNER JOINs;
    //      - `message_reply` / `message_mention` rows are read by the RPC but
    //        never aggregated into any bucket, so the badge never shows them;
    //      - `direct_message` rows are excluded when the latest message in that
    //        conversation was authored by the user themself.
    //    Those three divergences were the source of implausible counts.
    type NotifRow = { user_id: string; type: string; related_id: string | null };
    const notifRows: NotifRow[] = [];
    for (const userChunk of chunk(eligibleUsers, 200)) {
      const rows = await fetchAllPages<NotifRow>(
        "notifications",
        () => supabase
          .from("notifications")
          .select("user_id, type, related_id")
          .in("user_id", userChunk)
          .eq("is_read", false)
          .in("type", BADGE_COUNTED_NOTIFICATION_TYPES)
          .order("id"),
      );
      notifRows.push(...rows);
    }

    const relatedIdsFor = (type: string) =>
      Array.from(new Set(
        notifRows.filter(r => r.type === type && r.related_id).map(r => r.related_id as string)
      ));

    /** Ids that still resolve to a live message row with a non-null scope column. */
    const resolveExisting = async (table: string, scopeCol: string, ids: string[]) => {
      const found = new Set<string>();
      for (const idChunk of chunk(ids, 150)) {
        const rows = await fetchAllPages<{ id: string }>(
          table,
          () => supabase
            .from(table)
            .select(`id, ${scopeCol}`)
            .in("id", idChunk)
            .not(scopeCol, "is", null)
            .order("id"),
        );
        for (const r of rows) found.add(r.id);
      }
      return found;
    };

    const existingByType: Record<string, Set<string>> = {
      team_message: await resolveExisting("team_messages", "team_id", relatedIdsFor("team_message")),
      club_message: await resolveExisting("club_messages", "club_id", relatedIdsFor("club_message")),
      group_message: await resolveExisting("group_messages", "group_id", relatedIdsFor("group_message")),
    };

    // DM conversations: latest author must not be the recipient themself. An
    // unresolvable conversation counts as excluded, matching the RPC's
    // `NULL <> _user_id` behaviour (fail closed, never inflate).
    const latestDmAuthor = new Map<string, string | null>();
    for (const convChunk of chunk(relatedIdsFor("direct_message"), 20)) {
      await Promise.all(convChunk.map(async (conversationId) => {
        const { data, error } = await supabase
          .from("direct_messages")
          .select("author_id")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) {
          console.error(`[EngagementReminder] latest DM author lookup failed for ${conversationId}:`, error);
          latestDmAuthor.set(conversationId, null);
          return;
        }
        latestDmAuthor.set(conversationId, data?.[0]?.author_id ?? null);
      }));
    }

    const unreadMessagesByUser: Record<string, number> = {};
    let badgeEquivalentRows = 0;
    for (const r of notifRows) {
      let counts: boolean;
      if (r.type === "broadcast") {
        counts = true;
      } else if (!r.related_id) {
        counts = false;
      } else if (r.type === "direct_message") {
        const author = latestDmAuthor.get(r.related_id) ?? null;
        counts = author !== null && author !== r.user_id;
      } else {
        counts = existingByType[r.type]?.has(r.related_id) ?? false;
      }
      if (!counts) continue;
      badgeEquivalentRows++;
      unreadMessagesByUser[r.user_id] = (unreadMessagesByUser[r.user_id] || 0) + 1;
    }
    console.log(
      `[EngagementReminder] unread notification rows fetched=${notifRows.length} badgeEquivalent=${badgeEquivalentRows} discarded=${notifRows.length - badgeEquivalentRows}`
    );

    // 6. Get recent photos (last 7 days) in Pro teams (paginated)
    const recentPhotos: Array<{ id: string; team_id: string | null; uploader_id: string | null }> = [];
    for (const teamIdChunk of chunk(proTeamIds, 200)) {
      const rows = await fetchAllPages<{ id: string; team_id: string | null; uploader_id: string | null }>(
        "photos",
        () => supabase
          .from("photos")
          .select("id, team_id, uploader_id")
          .in("team_id", teamIdChunk)
          .gte("created_at", sevenDaysAgo)
          .is("deleted_at", null)
          .order("id"),
      );
      recentPhotos.push(...rows);
    }

    // 7. Get photo VIEWS (never reactions) for the recent photo set — paginated.
    //    Filtered only by photo_id so the request URL stays well inside limits;
    //    rows for non-eligible users are dropped client-side.
    const eligibleUserSet = new Set(eligibleUsers);
    const viewedPhotoSet = new Set<string>();
    const recentPhotoIds = recentPhotos.map(p => p.id);
    for (const photoIdChunk of chunk(recentPhotoIds, 150)) {
      const rows = await fetchAllPages<{ id: string; user_id: string; photo_id: string }>(
        "photo_views",
        () => supabase
          .from("photo_views")
          .select("id, user_id, photo_id")
          .in("photo_id", photoIdChunk)
          .order("id"),
      );
      for (const r of rows) {
        if (eligibleUserSet.has(r.user_id)) viewedPhotoSet.add(`${r.user_id}:${r.photo_id}`);
      }
    }


    // 8. Calculate counts per eligible user and build notifications
    let totalSent = 0;
    let skippedBySanityGuard = 0;
    // Notification and cooldown-log rows stay paired so a failed notification
    // batch can never leave a cooldown behind for its recipients.
    const reminders: ReminderEntry[] = [];


    // Get club points display names
    const clubPointsNames: Record<string, string> = {};
    for (const c of proClubs) {
      clubPointsNames[c.club_id] = 'reward points'; // default
    }
    for (const clubIdChunk of chunk(proClubIds, 200)) {
      const rows = await fetchAllPages<{ id: string; points_display_name: string | null }>(
        "clubs",
        () => supabase
          .from("clubs")
          .select("id, points_display_name")
          .in("id", clubIdChunk)
          .order("id"),
      );
      for (const c of rows) {
        if (c.points_display_name) clubPointsNames[c.id] = c.points_display_name;
      }
    }


    for (const userId of eligibleUsers) {
      const userTeamIds = userTeams[userId];

      const unreadMessages = unreadMessagesByUser[userId] || 0;

      // Count unseen photos (exclude own uploads, exclude photos already viewed).
      // If no view rows exist for a photo we treat it as unseen only because a
      // missing view row means it was never opened; total unseen is still capped
      // by the sanity guard below.
      const unseenPhotos = recentPhotos.filter(p =>
        p.team_id && userTeamIds.includes(p.team_id) &&
        p.uploader_id !== userId &&
        !viewedPhotoSet.has(`${userId}:${p.id}`)
      ).length;

      const totalUnread = unreadMessages + unseenPhotos;

      if (totalUnread < 5) continue;

      // Sanity guard: never send an implausible number.
      if (unreadMessages > UNREAD_SANITY_CEILING || unseenPhotos > UNREAD_SANITY_CEILING) {
        skippedBySanityGuard++;
        console.warn(
          `[EngagementReminder] SANITY GUARD skip user=${userId} unreadMessages=${unreadMessages} unseenPhotos=${unseenPhotos} ceiling=${UNREAD_SANITY_CEILING}`
        );
        continue;
      }

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

      reminders.push({
        notification: {
          user_id: userId,
          type: "engagement_reminder",
          message,
        },
        log: {
          user_id: userId,
          unread_messages_count: unreadMessages,
          unread_photos_count: unseenPhotos,
        },
      });
    }

    // Insert reminders, then cooldown logs for successful batches only.
    // A cooldown-log failure throws and is handled below as a sanitized 500.
    const dispatch = await dispatchReminders(supabase, reminders);
    totalSent = dispatch.totalSent;
    if (dispatch.failedNotificationBatches > 0) {
      console.error(
        `[EngagementReminder] failedNotificationBatches=${dispatch.failedNotificationBatches} (no cooldowns written for those recipients)`,
      );
    }


    console.log(
      `[EngagementReminder] COMPLETE: evaluated=${eligibleUsers.length} notified=${totalSent} skippedBySanityGuard=${skippedBySanityGuard} belowThreshold=${eligibleUsers.length - notifications.length - skippedBySanityGuard}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        eligible: eligibleUsers.length,
        evaluated: eligibleUsers.length,
        notified: totalSent,
        skipped_sanity_guard: skippedBySanityGuard,
      }),
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
