import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

interface TeamChatPreviewProps {
  teamId: string;
}

export function TeamChatPreview({ teamId }: TeamChatPreviewProps) {
  const { user } = useAuth();

  // Get latest message
  const { data: latestMessage } = useQuery({
    queryKey: ["team-chat-preview", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_messages")
        .select("id, text, created_at, author_id, is_club_announcement, club_announcement_name")
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;

      // For club announcements, use the club name instead of the author's profile
      if (data.is_club_announcement && data.club_announcement_name) {
        return {
          ...data,
          authorName: data.club_announcement_name,
        };
      }

      // Get author profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", data.author_id)
        .maybeSingle();

      return {
        ...data,
        authorName: profile?.display_name || "Someone",
      };
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Get unread count
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["team-chat-unread", teamId, user?.id],
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0;

      // Get IDs of messages in this team that the user has already read
      const { data: readMessages } = await supabase
        .from("message_reads")
        .select("team_message_id")
        .eq("user_id", user.id)
        .not("team_message_id", "is", null);

      const readIds = (readMessages || []).map(r => r.team_message_id).filter(Boolean) as string[];

      // Count unread messages: messages in this team, not by current user, not in read list
      let query = supabase
        .from("team_messages")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .neq("author_id", user.id);

      if (readIds.length > 0) {
        // Exclude already-read messages
        query = query.not("id", "in", `(${readIds.join(",")})`);
      }

      const { count } = await query;
      return (count as number) || 0;
    },
    enabled: !!teamId && !!user?.id,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold">Team Chat</span>
        {latestMessage ? (
          <p className="text-[11px] text-muted-foreground truncate">
            <span className="font-medium">
              {latestMessage.author_id === user?.id ? "You" : latestMessage.authorName}:
            </span>{" "}
            {latestMessage.text.length > 40
              ? latestMessage.text.slice(0, 40) + "…"
              : latestMessage.text}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">No messages yet — say hello! 👋</p>
        )}
      </div>
      {unreadCount > 0 && (
        <Badge className="bg-primary text-primary-foreground text-[10px] h-5 min-w-[20px] flex items-center justify-center px-1.5 shrink-0">
          {unreadCount > 99 ? "99+" : unreadCount}
        </Badge>
      )}
    </div>
  );
}
