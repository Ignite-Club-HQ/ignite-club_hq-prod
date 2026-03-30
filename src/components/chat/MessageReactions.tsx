import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
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
  anchorRef: RefObject<HTMLDivElement>;
}

export const MessageReactionsPopover = memo(function MessageReactionsPopover({
  reactions = [],
  currentUserId,
  onReact,
  onRemove,
  isOpen,
  onOpenChange,
  isOwnMessage = false,
  anchorRef,
}: MessageReactionsProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const lastTouchReactionAtRef = useRef(0);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const rootStyles = getComputedStyle(document.documentElement);
      const bottomNavOffset = Number.parseFloat(rootStyles.getPropertyValue("--bottom-nav-offset")) || 0;
      const pickerWidth = Math.min(280, window.innerWidth - 16);
      const pickerHeight = 124;
      const topBoundary = viewportOffsetTop + 72;
      const bottomBoundary = viewportOffsetTop + viewportHeight - bottomNavOffset - 92;
      const gap = 12;
      const spaceAbove = rect.top - topBoundary;
      const spaceBelow = bottomBoundary - rect.bottom;
      const showBelow = spaceAbove < pickerHeight && spaceBelow >= pickerHeight + gap;

      const unclampedTop = showBelow
        ? rect.bottom + gap
        : rect.top - pickerHeight - gap;
      const top = Math.max(
        topBoundary,
        Math.min(unclampedTop, bottomBoundary - pickerHeight)
      );

      let left = isOwnMessage ? rect.right - pickerWidth : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8));

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, isOpen, isOwnMessage]);

  const handleEmojiClick = (type: string) => {
    console.log('[ReactionPicker] Emoji tapped:', type, 'currentUserId:', currentUserId);
    const userReaction = reactions.find(
      (r) => r.user_id === currentUserId && r.reaction_type === type
    );

    if (userReaction) {
      console.log('[ReactionPicker] Removing existing reaction:', userReaction.id);
      onRemove(userReaction.id);
    } else {
      console.log('[ReactionPicker] Adding/changing reaction to:', type);
      onReact(type);
    }
    onOpenChange(false);
  };

  if (!isOpen || !position) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100001]"
      data-reaction-picker="true"
      onClick={(e) => {
        e.stopPropagation();
        console.log('[ReactionPicker] Backdrop tapped - closing');
        onOpenChange(false);
      }}
      onTouchEnd={(e) => {
        // Only close if the touch target is the backdrop itself, not a child button
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          e.preventDefault();
          console.log('[ReactionPicker] Backdrop touch - closing');
          onOpenChange(false);
        }
      }}
    >
      <div
        className="absolute"
        style={{
          top: position.top,
          left: position.left,
          width: "min(280px, calc(100vw - 16px))",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div className="bg-popover border rounded-lg p-2 shadow-lg">
          <div className="flex gap-1.5">
            {REACTION_EMOJIS.map(({ type, emoji }) => {
              const userHasReaction = reactions.some(
                (r) => r.user_id === currentUserId && r.reaction_type === type
              );

              return (
                <button
                  key={type}
                  type="button"
                  onTouchStart={(e) => {
                    e.stopPropagation();
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    lastTouchReactionAtRef.current = Date.now();
                    console.log('[ReactionPicker] Touch on emoji:', type);
                    handleEmojiClick(type);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    // Fallback for Android WebView where onTouchEnd may not fire
                    if (Date.now() - lastTouchReactionAtRef.current < 750) return;
                    lastTouchReactionAtRef.current = Date.now();
                    console.log('[ReactionPicker] PointerUp on emoji:', type);
                    handleEmojiClick(type);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (Date.now() - lastTouchReactionAtRef.current < 750) return;
                    lastTouchReactionAtRef.current = Date.now();
                    console.log('[ReactionPicker] Click on emoji:', type);
                    handleEmojiClick(type);
                  }}
                  className={`inline-flex items-center justify-center h-9 w-9 rounded-md text-lg shrink-0 transition-colors active:bg-accent ${
                    userHasReaction ? "bg-primary/20" : "hover:bg-accent"
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="w-full mt-1 text-xs text-muted-foreground py-1.5 rounded-md active:bg-accent"
            onTouchEnd={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onOpenChange(false);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
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