import { memo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "wow", emoji: "😮" },
  { type: "sad", emoji: "😢" },
];

interface CommentReaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface CommentReactionsDisplayProps {
  reactions: CommentReaction[];
  currentUserId?: string;
  onReactionClick: (type: string) => void;
}

export const CommentReactionsDisplay = memo(function CommentReactionsDisplay({
  reactions,
  currentUserId,
  onReactionClick,
}: CommentReactionsDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reactions || reactions.length === 0) return null;

  const allUserIds = [...new Set(reactions.map(r => r.user_id))];

  const reactionCounts = reactions.reduce((acc, r) => {
    if (!acc[r.reaction_type]) {
      acc[r.reaction_type] = { count: 0, userIds: [] };
    }
    acc[r.reaction_type].count++;
    acc[r.reaction_type].userIds.push(r.user_id);
    return acc;
  }, {} as Record<string, { count: number; userIds: string[] }>);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div className="flex flex-wrap gap-1 mt-1">
          {Object.entries(reactionCounts).map(([type, { count }]) => {
            const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
            const isUserReaction = reactions.some(
              (r) => r.user_id === currentUserId && r.reaction_type === type
            );
            return (
              <button
                key={type}
                onClick={(e) => {
                  e.stopPropagation();
                  onReactionClick(type);
                }}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs ${
                  isUserReaction
                    ? "bg-primary/20 border border-primary/40"
                    : "bg-muted/50 hover:bg-muted"
                }`}
              >
                <span>{emoji}</span>
                <span className="text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 bg-popover border z-50" align="start" side="top" sideOffset={8}>
        <CommentReactionUsers
          reactions={reactions}
          allUserIds={allUserIds}
          currentUserId={currentUserId}
          isOpen={isOpen}
        />
      </PopoverContent>
    </Popover>
  );
});

const CommentReactionUsers = memo(function CommentReactionUsers({
  reactions,
  allUserIds,
  currentUserId,
  isOpen,
}: {
  reactions: CommentReaction[];
  allUserIds: string[];
  currentUserId?: string;
  isOpen: boolean;
}) {
  const { data: users = [] } = useQuery({
    queryKey: ["comment-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", allUserIds);
      if (error) throw error;
      return data;
    },
    enabled: isOpen && allUserIds.length > 0,
  });

  const reactionsByType = reactions.reduce((acc, r) => {
    if (!acc[r.reaction_type]) acc[r.reaction_type] = [];
    acc[r.reaction_type].push(r);
    return acc;
  }, {} as Record<string, CommentReaction[]>);

  const getUserName = (userId: string) =>
    users.find(u => u.id === userId)?.display_name || "";

  return (
    <div className="flex flex-col gap-3 max-h-60 overflow-y-auto min-w-[160px]">
      <p className="text-xs font-medium text-muted-foreground">Reactions</p>
      {Object.entries(reactionsByType).map(([type, typeReactions]) => {
        const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
        return (
          <div key={type} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-base">{emoji}</span>
              <span className="text-xs text-muted-foreground">({typeReactions.length})</span>
            </div>
            <div className="pl-6 flex flex-col gap-0.5">
              {typeReactions.map((r) => (
                <p key={r.id} className="text-sm">
                  {getUserName(r.user_id)}
                  {r.user_id === currentUserId && " (you)"}
                </p>
              ))}
            </div>
          </div>
        );
      })}
      {users.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
    </div>
  );
});
