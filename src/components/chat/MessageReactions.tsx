import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { runWhenChatScrollIdle } from "@/lib/chatScrollActivity";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfilesWithCache } from "@/lib/profileCache";

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

const getReactionSignature = (reactions: Reaction[] = []) =>
  reactions
    .map((reaction) => `${reaction.id}:${reaction.user_id}:${reaction.reaction_type}`)
    .sort()
    .join("|");

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

  // Defer reactions visibility commits until chat scrolling is idle.
  // A realtime reaction arriving on a message currently above the
  // viewport would otherwise grow that row by ~22px and shove every
  // visible row below it down by the same amount mid-flick. We commit
  // the visible reaction set on first mount immediately (no scroll yet),
  // then route subsequent changes through `runWhenChatScrollIdle` so
  // pop-ins always happen between flicks.
  const [committed, setCommitted] = useState<Reaction[]>(reactions);
  const committedSignatureRef = useRef(getReactionSignature(reactions));
  useEffect(() => {
    const nextSignature = getReactionSignature(reactions);
    if (nextSignature === committedSignatureRef.current) return;

    return runWhenChatScrollIdle(() => {
      committedSignatureRef.current = nextSignature;
      setCommitted(reactions);
    }, 250);
  }, [reactions]);

  if (!committed || committed.length === 0) return null;

  const allUserIds = [...new Set(committed.map(r => r.user_id))];

  // Group reactions by type
  const reactionCounts = committed.reduce((acc, r) => {
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
        reactions={committed}
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
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["all-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const map = await fetchProfilesWithCache(allUserIds);
      return Array.from(map.values()).map((p) => ({
        id: p.id,
        display_name: p.display_name,
      }));
    },
    enabled: isOpen && allUserIds.length > 0,
    staleTime: 60_000,
  });

  const reactionsByType = reactions.reduce((acc, r) => {
    if (!acc[r.reaction_type]) {
      acc[r.reaction_type] = [];
    }
    acc[r.reaction_type].push(r);
    return acc;
  }, {} as Record<string, Reaction[]>);

  const types = Object.keys(reactionsByType);
  const [activeType, setActiveType] = useState<string | "all">("all");

  // Reset filter when popover reopens
  useLayoutEffect(() => {
    if (isOpen) setActiveType("all");
  }, [isOpen]);

  const getUserName = (userId: string) => {
    return users.find(u => u.id === userId)?.display_name || "";
  };

  const visibleReactions =
    activeType === "all"
      ? reactions
      : reactionsByType[activeType] ?? [];

  const totalCount = reactions.length;

  return (
    <PopoverContent
      className="w-[244px] max-w-[calc(100vw-1.5rem)] p-0 overflow-hidden rounded-2xl border border-border/40 bg-popover/95 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)] z-50"
      align="end"
      side="top"
      sideOffset={6}
      collisionPadding={12}
      avoidCollisions
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {/* Filter chips */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveType("all")}
          className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-medium leading-none shrink-0 transition-colors ${
            activeType === "all"
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.04]"
          }`}
        >
          <span>All</span>
          <span className="tabular-nums opacity-70">{totalCount}</span>
        </button>
        {types.map((type) => {
          const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
          const count = reactionsByType[type].length;
          const active = activeType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={`inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full text-[11px] font-medium leading-none shrink-0 transition-colors ${
                active
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              <span className="text-[13px] leading-none">{emoji}</span>
              <span className="tabular-nums opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="h-px bg-border/40 mx-2" />

      {/* Reactor list */}
      <div className="max-h-[244px] overflow-y-auto py-1">
        {usersLoading && users.length === 0 ? (
          <div className="space-y-1.5 px-3 py-2">
            {visibleReactions.slice(0, Math.min(visibleReactions.length, 4)).map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <div className="flex-1 h-3 rounded bg-foreground/[0.06] animate-pulse" />
                <div className="h-3 w-3 rounded-full bg-foreground/[0.06] animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {visibleReactions.map((r) => {
              const isMe = r.user_id === currentUserId;
              const name = getUserName(r.user_id) || "Unknown";
              const emoji = REACTION_EMOJIS.find((e) => e.type === r.reaction_type)?.emoji || "❤️";
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={(e) => {
                    if (!isMe) return;
                    e.stopPropagation();
                    onReactionClick(r.reaction_type, r.id);
                    onClose();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isMe ? "hover:bg-foreground/[0.04] cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/85">
                    {name}
                    {isMe && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {`· tap to remove`}
                      </span>
                    )}
                  </span>
                  <span className="text-[14px] leading-none">{emoji}</span>
                </button>
              );
            })}
            {visibleReactions.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-muted-foreground">No reactions</p>
            )}
          </>
        )}
      </div>
    </PopoverContent>
  );
});

export { REACTION_EMOJIS };