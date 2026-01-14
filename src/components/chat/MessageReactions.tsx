import { memo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "thumbsup", emoji: "👍" },
  { type: "sad", emoji: "😢" },
];

interface Reaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface MessageReactionsProps {
  reactions: Reaction[];
  currentUserId?: string;
  onReact: (reactionType: string) => void;
  onRemove: (reactionId: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isOwnMessage?: boolean;
}

export const MessageReactionsPopover = memo(function MessageReactionsPopover({
  reactions = [],
  currentUserId,
  onReact,
  onRemove,
  isOpen,
  onOpenChange,
  isOwnMessage = false,
}: MessageReactionsProps) {
  const [showBelow, setShowBelow] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  
  // Check if popover would be cut off at top of screen
  useEffect(() => {
    if (isOpen && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      // If the popover top is above the viewport (negative or very close to 0), show below instead
      if (rect.top < 10) {
        setShowBelow(true);
      } else {
        setShowBelow(false);
      }
    }
  }, [isOpen]);
  
  const handleEmojiClick = (type: string) => {
    const userReaction = reactions.find(
      (r) => r.user_id === currentUserId && r.reaction_type === type
    );
    
    if (userReaction) {
      // Clicking the same reaction they already have - remove it
      onRemove(userReaction.id);
    } else {
      // Clicking a different reaction - onReact will handle removing old and adding new
      onReact(type);
    }
    onOpenChange(false);
  };

  // Use conditional rendering instead of a controlled popover with invisible trigger
  if (!isOpen) return null;

  return (
    <div 
      ref={popoverRef}
      className={`absolute z-50 ${isOwnMessage ? 'right-0' : 'left-0'} ${
        showBelow ? 'top-full mt-2' : 'bottom-full mb-2'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-popover border rounded-lg p-2 shadow-lg">
        <div className="flex gap-1.5">
          {REACTION_EMOJIS.map(({ type, emoji }) => {
            const userHasReaction = reactions.some(
              (r) => r.user_id === currentUserId && r.reaction_type === type
            );
            return (
              <Button
                key={type}
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEmojiClick(type);
                }}
                className={`h-9 w-9 p-0 text-lg shrink-0 ${
                  userHasReaction ? "bg-primary/20" : ""
                }`}
              >
                {emoji}
              </Button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-1 text-xs text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
});

interface MessageReactionsDisplayProps {
  reactions?: Reaction[];
  currentUserId?: string;
  onReactionClick: (type: string, reactionId?: string) => void;
}

export const MessageReactionsDisplay = memo(function MessageReactionsDisplay({
  reactions = [],
  currentUserId,
  onReactionClick,
}: MessageReactionsDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reactions || reactions.length === 0) return null;

  const allUserIds = [...new Set(reactions.map(r => r.user_id))];

  // Group reactions by type
  const reactionCounts = reactions.reduce((acc, r) => {
    if (!acc[r.reaction_type]) {
      acc[r.reaction_type] = { count: 0, reactions: [], userIds: [] };
    }
    acc[r.reaction_type].count++;
    acc[r.reaction_type].reactions.push(r);
    acc[r.reaction_type].userIds.push(r.user_id);
    return acc;
  }, {} as Record<string, { count: number; reactions: Reaction[]; userIds: string[] }>);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div className="flex flex-wrap gap-1 mt-1">
          {Object.entries(reactionCounts).map(([type, { count, reactions: typeReactions }]) => {
            const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
            const userReaction = typeReactions.find((r) => r.user_id === currentUserId);
            
            return (
              <button
                key={type}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(true);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                  userReaction
                    ? "bg-primary/20 text-primary"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                <span>{emoji}</span>
                <span>{count}</span>
              </button>
            );
          })}
        </div>
      </PopoverTrigger>
      <AllReactionsContent
        reactions={reactions}
        allUserIds={allUserIds}
        currentUserId={currentUserId}
        onReactionClick={onReactionClick}
        onClose={() => setIsOpen(false)}
        isOpen={isOpen}
      />
    </Popover>
  );
});

interface AllReactionsContentProps {
  reactions: Reaction[];
  allUserIds: string[];
  currentUserId?: string;
  onReactionClick: (type: string, reactionId?: string) => void;
  onClose: () => void;
  isOpen: boolean;
}

const AllReactionsContent = memo(function AllReactionsContent({
  reactions,
  allUserIds,
  currentUserId,
  onReactionClick,
  onClose,
  isOpen,
}: AllReactionsContentProps) {
  const { data: users = [] } = useQuery({
    queryKey: ["all-reaction-users", allUserIds],
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
    if (!acc[r.reaction_type]) {
      acc[r.reaction_type] = [];
    }
    acc[r.reaction_type].push(r);
    return acc;
  }, {} as Record<string, Reaction[]>);

  const getUserName = (userId: string) => {
    return users.find(u => u.id === userId)?.display_name || "";
  };

  return (
    <PopoverContent 
      className="w-auto p-3 bg-popover border z-50" 
      align="start" 
      side="top"
      sideOffset={8}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-3 max-h-60 overflow-y-auto min-w-[160px]">
        <p className="text-xs font-medium text-muted-foreground">Reactions</p>
        {Object.entries(reactionsByType).map(([type, typeReactions]) => {
          const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
          const userReaction = typeReactions.find((r) => r.user_id === currentUserId);
          
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
              {userReaction && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-6 h-6 text-xs text-destructive hover:text-destructive justify-start px-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReactionClick(type, userReaction.id);
                    onClose();
                  }}
                >
                  Remove your {emoji}
                </Button>
              )}
            </div>
          );
        })}
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </div>
    </PopoverContent>
  );
});

export { REACTION_EMOJIS };