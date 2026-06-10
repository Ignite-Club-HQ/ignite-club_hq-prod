import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineCount } from "@/hooks/useUserPresence";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export type ChatOnlineCountType = "team" | "club" | "group";

interface Options {
  /** For "group" chats only. */
  teamId?: string | null;
  /** For "group" chats only. */
  clubId?: string | null;
  /** For "group" chats only — mini-league scoped chats. */
  miniLeagueId?: string | null;
  /** For "group" chats only. */
  groupAllowedRoles?: AppRole[] | null;
  enabled?: boolean;
}

/**
 * Fetches the user IDs that participate in a given chat (team/club/group)
 * and returns how many of them are currently online.
 *
 * Combines two sources of truth:
 *   1. Realtime presence channel (instant, but unreliable on mobile when the
 *      websocket drops in background).
 *   2. DB heartbeat (`user_presence`, last_seen_at within 90s) — survives
 *      backgrounding and network blips on native apps.
 *
 * The current user is excluded from the count.
 */
export function useChatOnlineCount(
  chatType: ChatOnlineCountType,
  chatId: string | null | undefined,
  opts: Options = {},
): number {
  const { user } = useAuth();
  const { teamId, clubId, miniLeagueId, groupAllowedRoles, enabled = true } = opts;

  const { data: memberIds } = useQuery({
    queryKey: [
      "chat-online-member-ids",
      chatType,
      chatId,
      teamId ?? null,
      clubId ?? null,
      miniLeagueId ?? null,
      groupAllowedRoles ?? null,
    ],
    queryFn: async (): Promise<string[]> => {
      if (!chatId) return [];

      // Mini-league group: mirror notification recipient scoping in
      // process-message-notifications so the online count matches who
      // actually has access (NOT all club members with allowed_roles).
      if (chatType === "group" && miniLeagueId) {
        const [parents, leagueAdmins, roleAdmins] = await Promise.all([
          supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null),
          supabase
            .from("mini_league_admins")
            .select("user_id")
            .eq("mini_league_id", miniLeagueId),
          clubId
            ? supabase
                .from("user_roles")
                .select("user_id")
                .eq("club_id", clubId)
                .eq("role", "league_admin")
            : Promise.resolve({ data: [] as Array<{ user_id: string }> }),
        ]);
        const ids = [
          ...((parents.data || []).map((r: any) => r.parent_user_id).filter(Boolean) as string[]),
          ...((leagueAdmins.data || []).map((r: any) => r.user_id) as string[]),
          ...((roleAdmins.data || []).map((r: any) => r.user_id) as string[]),
        ];
        return [...new Set(ids)];
      }

      // Personal group (not tied to a team or club): use group_members table.
      if (chatType === "group" && !teamId && !clubId) {
        const { data, error } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", chatId);
        if (error || !data) return [];
        return [...new Set(data.map((r) => r.user_id))];
      }

      let query;
      if (chatType === "team") {
        query = supabase.from("user_roles").select("user_id").eq("team_id", chatId);
      } else if (chatType === "club") {
        query = supabase.from("user_roles").select("user_id").eq("club_id", chatId);
      } else if (chatType === "group") {
        const roles = (groupAllowedRoles || []) as AppRole[];
        if (teamId) {
          query = supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", teamId)
            .in("role", roles);
        } else if (clubId) {
          query = supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", clubId)
            .in("role", roles);
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data, error } = await query;
      if (error || !data) return [];
      const ids = (data as Array<{ user_id: string }>).map((r) => r.user_id);
      return [...new Set(ids)];
    },
    enabled: enabled && !!chatId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const ids = useMemo(() => memberIds || [], [memberIds]);

  // --- Source 1: Realtime presence channel ---
  const realtimeCount = useOnlineCount(ids, user?.id);

  // --- Source 2: DB heartbeat fallback ---
  // Polls the user_presence heartbeat table for any of the chat members
  // active in the last 90 seconds. Reliable across app backgrounding.
  const { data: heartbeatOnlineIds } = useQuery({
    queryKey: ["chat-online-heartbeat", ids, user?.id ?? null],
    queryFn: async (): Promise<string[]> => {
      if (!ids.length) return [];
      const { data, error } = await supabase.rpc(
        "get_online_users_from_set" as any,
        { _user_ids: ids },
      );
      if (error || !data) return [];
      return (data as Array<{ user_id: string }>)
        .map((r) => r.user_id)
        .filter((id) => id !== user?.id);
    },
    enabled: enabled && ids.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000,
  });

  // The realtime set is a superset on desktop (instant join/leave), the
  // heartbeat set is a superset on mobile (survives backgrounding). Taking
  // the max gives the correct answer in both environments without inflating
  // the count via double-counting.
  return useMemo(() => {
    const heartbeatCount = (heartbeatOnlineIds || []).length;
    return Math.max(realtimeCount, heartbeatCount);
  }, [realtimeCount, heartbeatOnlineIds]);
}
