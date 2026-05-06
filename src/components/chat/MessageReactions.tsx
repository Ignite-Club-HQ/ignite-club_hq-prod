import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

const REACTION_EMOJIS = [
  { type: "thumbsup", emoji: "👍" },
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
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
  isMutating?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isOwnMessage?: boolean;
  anchorRef: RefObject<HTMLDivElement>;
  preventIfGuarded?: (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => boolean;
}

export const MessageReactionsPopover = memo(function MessageReactionsPopover({
  reactions = [],
  currentUserId,
  onReact,
  onRemove,
  isMutating = false,
  isOpen,
  onOpenChange,
  isOwnMessage = false,
  anchorRef,
  preventIfGuarded,
}: MessageReactionsProps) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const lastTouchReactionAtRef = useRef<{ at: number; type: string } | null>(null);
  // Ignore dismiss events for a short window after mount.
  const mountedAtRef = useRef(0);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) {
      setPosition(null);
      return;
    }
    mountedAtRef.current = Date.now();

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const rootStyles = getComputedStyle(document.documentElement);
      const bottomNavOffset = Number.parseFloat(rootStyles.getPropertyValue("--bottom-nav-offset")) || 0;
      const minPickerWidth = 244;
      const pickerWidth = Math.max(minPickerWidth, Math.min(rect.width, 320));
      const pickerHeight = 44;
      const topBoundary = viewportOffsetTop + 72;
      const bottomBoundary = viewportOffsetTop + viewportHeight - bottomNavOffset - 92;
      const gap = 0;
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

      setPosition({ top, left, width: pickerWidth });
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
    onReact(type);
    onOpenChange(false);
  };

  const triggerEmojiSelection = (type: string) => {
    const now = Date.now();
    const lastTouchReaction = lastTouchReactionAtRef.current;

    if (
      lastTouchReaction &&
      lastTouchReaction.type === type &&
      now - lastTouchReaction.at < 350
    ) {
      return;
    }

    lastTouchReactionAtRef.current = { at: now, type };
    handleEmojiClick(type);
  };

  if (!isOpen || !position) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100001]"
      data-reaction-picker="true"
      style={{ touchAction: "none", pointerEvents: "auto" }}
      onPointerDown={(e) => {
        // Prevent focus steal so keyboard stays open
        e.preventDefault();
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (Date.now() - mountedAtRef.current < 400) return;
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
      onTouchEnd={(e) => {
        if (e.target === e.currentTarget) {
          if (Date.now() - mountedAtRef.current < 400) return;
          e.stopPropagation();
          e.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      <div
        className="absolute"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          touchAction: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        <div className="dark:bg-popover/90 bg-muted/90 backdrop-blur-md dark:border dark:border-border/20 border border-black/[0.03] rounded-2xl px-1.5 py-1 shadow-none dark:shadow-sm animate-in fade-in zoom-in-95 slide-in-from-bottom-1 duration-150">
          <div className="flex justify-around">
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
                    e.preventDefault();
                    // Ignore touches that arrive within 500ms of the picker opening
                    // to prevent accidental selection from the long-press finger lift
                    if (Date.now() - mountedAtRef.current < 500) return;
                    triggerEmojiSelection(type);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    // Also trigger on touchEnd as fallback, but with the same guard
                    if (Date.now() - mountedAtRef.current < 500) return;
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (Date.now() - mountedAtRef.current < 500) return;
                    triggerEmojiSelection(type);
                  }}
                  style={{ touchAction: "none" }}
                  className={`inline-flex items-center justify-center h-10 w-10 rounded-full text-lg shrink-0 transition-all duration-75 active:scale-110 touch-manipulation ${
                    userHasReaction ? "bg-primary/10 scale-[1.08]" : "hover:bg-accent/50"
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
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
        <div className="relative z-10 flex flex-wrap gap-1 mt-1">
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
                className={`inline-flex items-center gap-0.5 pl-1.5 pr-1.5 py-[1px] rounded-full text-[11px] leading-none ring-1 ring-background transition-colors ${
                  userReaction
                    ? "bg-primary/15 text-primary"
                    : "bg-muted/80 text-foreground/75 hover:bg-muted"
                }`}
              >
                <span className="text-[12px] leading-none">{emoji}</span>
                <span className="tabular-nums">{count}</span>
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
      className="w-auto max-w-[calc(100vw-2rem)] p-3 bg-popover border z-50" 
      align="end" 
      side="top"
      sideOffset={8}
      collisionPadding={12}
      avoidCollisions
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