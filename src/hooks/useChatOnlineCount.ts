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
  /** For "group" chats only. */
  groupAllowedRoles?: AppRole[] | null;
  enabled?: boolean;
}

/**
 * Fetches the user IDs that participate in a given chat (team/club/group)
 * and returns how many of them are currently online via Realtime presence.
 *
 * The current user is excluded from the count.
 *
 * Uses the same query keys as ChatParticipantsList so cached data is shared.
 */
export function useChatOnlineCount(
  chatType: ChatOnlineCountType,
  chatId: string | null | undefined,
  opts: Options = {},
): number {
  const { user } = useAuth();
  const { teamId, clubId, groupAllowedRoles, enabled = true } = opts;

  const { data: memberIds } = useQuery({
    // Distinct key — we don't want to collide with the richer chat-members
    // query (which also fetches profile fields). Cheap & fast.
    queryKey: [
      "chat-online-member-ids",
      chatType,
      chatId,
      teamId ?? null,
      clubId ?? null,
      groupAllowedRoles ?? null,
    ],
    queryFn: async (): Promise<string[]> => {
      if (!chatId) return [];

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
      return [...new Set(data.map((r: { user_id: string }) => r.user_id))];
    },
    enabled: enabled && !!chatId,
    staleTime: 1000 * 60 * 5,
  });

  const ids = useMemo(() => memberIds || [], [memberIds]);
  return useOnlineCount(ids, user?.id);
}
