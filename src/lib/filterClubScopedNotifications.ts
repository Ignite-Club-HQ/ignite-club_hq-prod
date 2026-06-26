import { supabase } from "@/integrations/supabase/client";

interface NotifRow {
  id: string;
  type: string;
  related_id: string | null;
  [k: string]: any;
}

/**
 * Notifications with `club_id = NULL` include DMs and DM reactions. These leak
 * through the active-club filter because they aren't club-scoped at insert
 * time. This helper drops DM and reaction-on-DM rows whose counterpart user
 * doesn't share the active club with the recipient.
 *
 * Other NULL-club notification types (join_request, team_invite, role_request,
 * system_update, etc.) are intentionally kept visible in any club view.
 */
export async function filterClubScopedNotifications<T extends NotifRow>(
  rows: T[],
  recipientUserId: string,
  activeClubFilter: string,
): Promise<T[]> {
  if (!rows.length) return rows;

  const dmRows = rows.filter((n) => n.type === "direct_message" && n.related_id);
  const reactionRows = rows.filter((n) => n.type === "message_reaction" && n.related_id);

  if (!dmRows.length && !reactionRows.length) return rows;

  // Resolve DM author for direct_message rows
  const authorByDmMsg = new Map<string, string>();
  if (dmRows.length) {
    const msgIds = dmRows.map((n) => n.related_id as string);
    const { data: dms } = await supabase
      .from("direct_messages")
      .select("id, author_id")
      .in("id", msgIds);
    (dms || []).forEach((m: any) => authorByDmMsg.set(m.id, m.author_id));
  }

  // Resolve "other participant" for message_reaction rows whose related_id is
  // a direct_conversations id (DM reactions). Non-DM reactions (related_id is
  // team_id / club_id / group_id / broadcast_message_id) are simply left
  // alone — they aren't returned by this query and pass through unchanged.
  const otherByConversation = new Map<string, string>();
  if (reactionRows.length) {
    const convIds = reactionRows.map((n) => n.related_id as string);
    const { data: convs } = await supabase
      .from("direct_conversations")
      .select("id, participant_1, participant_2")
      .in("id", convIds);
    (convs || []).forEach((c: any) => {
      const other = c.participant_1 === recipientUserId ? c.participant_2 : c.participant_1;
      otherByConversation.set(c.id, other);
    });
  }

  const candidateUserIds = [
    ...new Set([
      ...authorByDmMsg.values(),
      ...otherByConversation.values(),
    ].filter(Boolean) as string[]),
  ];

  const allowedUsers = new Set<string>();
  if (candidateUserIds.length) {
    const { data: directRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("user_id", candidateUserIds)
      .eq("club_id", activeClubFilter);
    (directRoles || []).forEach((r: any) => allowedUsers.add(r.user_id));
    const { data: teamRoles } = await supabase
      .from("user_roles")
      .select("user_id, teams!inner(club_id)")
      .in("user_id", candidateUserIds)
      .eq("teams.club_id", activeClubFilter);
    (teamRoles || []).forEach((r: any) => allowedUsers.add(r.user_id));
  }

  return rows.filter((n) => {
    if (n.type === "direct_message") {
      const author = authorByDmMsg.get(n.related_id as string);
      return author ? allowedUsers.has(author) : false;
    }
    if (n.type === "message_reaction" && n.related_id) {
      // Only filter when related_id matches a DM conversation we resolved.
      // Reactions on team/club/group/broadcast messages won't be in the map
      // and pass through unchanged.
      const other = otherByConversation.get(n.related_id);
      if (!other) return true;
      return allowedUsers.has(other);
    }
    return true;
  });
}
