import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

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
        .select("id, text, created_at, author_id")
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;

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
    queryFn: async () => {
      if (!user?.id) return 0;

      // Get last read timestamp
      const { data: readData } = await supabase
        .from("message_reads")
        .select("read_at")
        .eq("user_id", user.id)
        .eq("team_id", teamId)
        .order("read_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastRead = readData?.read_at || "1970-01-01T00:00:00Z";

      const { count } = await supabase
        .from("team_messages")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .gt("created_at", lastRead)
        .neq("author_id", user.id);

      return count || 0;
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
          <p className="text-[11px] text-muted-foreground">Start a conversation</p>
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
