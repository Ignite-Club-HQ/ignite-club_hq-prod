import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ChatSharedMediaType = "team" | "club" | "group" | "dm" | "broadcast";

export interface SharedMediaItem {
  id: string;
  image_url: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
}

interface RawRow {
  id: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
}

const TABLE_AND_FILTER: Record<ChatSharedMediaType, { table: string; column: string | null }> = {
  team: { table: "team_messages", column: "team_id" },
  club: { table: "club_messages", column: "club_id" },
  group: { table: "group_messages", column: "group_id" },
  dm: { table: "direct_messages", column: "conversation_id" },
  broadcast: { table: "broadcast_messages", column: null },
};

const DEFAULT_LIMIT = 12;

export function useChatSharedMedia(
  chatType: ChatSharedMediaType,
  chatId: string | undefined,
  options?: { limit?: number; enabled?: boolean }
) {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const enabled = (options?.enabled ?? true) && !!chatId;

  return useQuery({
    queryKey: ["chat-shared-media", chatType, chatId, limit],
    queryFn: async (): Promise<SharedMediaItem[]> => {
      const { table, column } = TABLE_AND_FILTER[chatType];

      let query = (supabase as any)
        .from(table)
        .select("id, image_url, created_at, author_id")
        .not("image_url", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (column && chatId) {
        query = query.eq(column, chatId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("[useChatSharedMedia] error:", error);
        return [];
      }

      const rows = (data as RawRow[] | null) ?? [];
      const filtered = rows.filter((r) => !!r.image_url);

      const authorIds = Array.from(new Set(filtered.map((r) => r.author_id)));
      const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();

      if (authorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", authorIds);
        for (const p of profiles ?? []) {
          profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
        }
      }

      return filtered.map((r) => ({
        id: r.id,
        image_url: r.image_url as string,
        created_at: r.created_at,
        author_id: r.author_id,
        author_name: profileMap.get(r.author_id)?.display_name ?? null,
        author_avatar: profileMap.get(r.author_id)?.avatar_url ?? null,
      }));
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
