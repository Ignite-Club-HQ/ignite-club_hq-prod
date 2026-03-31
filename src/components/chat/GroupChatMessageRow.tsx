import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MoreVertical, Pencil, Trash2, Reply, Clock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { MessageContent } from "./MessageContent";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  author?: { display_name: string | null; avatar_url: string | null };
  reply_to?: { text: string; author?: { display_name: string | null } } | null;
}

interface GroupChatMessageRowProps {
  msg: GroupMessage;
  isOwnMessage: boolean;
  isAdmin: boolean;
  highlightedMessageId: string | null;
  messageReactions: any[];
  reactions: any[];
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  readFrontier: Record<string, ReaderInfo[]>;
  readCounts: Record<string, number>;
  handleReply: (msg: GroupMessage) => void;
  handleEdit: (msg: GroupMessage) => void;
  deleteMessageMutation: { mutate: (id: string) => void };
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  REACTION_EMOJIS: string[];
  groupId?: string;
}

export const GroupChatMessageRow = memo(function GroupChatMessageRow({
  msg,
  isOwnMessage,
  isAdmin,
  highlightedMessageId,
  messageReactions,
  reactions,
  userId,
  getProfile,
  readFrontier,
  readCounts,
  handleReply,
  handleEdit,
  deleteMessageMutation,
  toggleReactionMutation,
  REACTION_EMOJIS,
  groupId,
}: GroupChatMessageRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const releaseGuardRef = useRef(false);
  const ignoreNextContextMenuRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const showActionTrigger = showMenu || showReactionPicker || isDropdownOpen;

  const closeActionUi = useCallback(() => {
    setShowMenu(false);
    setShowReactionPicker(false);
    setIsDropdownOpen(false);
  }, []);

  const closeReactionPicker = useCallback(() => {
    setShowReactionPicker(false);
    if (!isDropdownOpen) {
      setShowMenu(false);
    }
  }, [isDropdownOpen]);

  const handleDropdownOpenChange = useCallback((open: boolean) => {
    setIsDropdownOpen(open);
    if (!open) {
      setShowMenu(false);
    }
  }, []);

  const openActionMenu = useCallback(() => {
    setShowReactionPicker(false);
    setShowMenu(true);
    setIsDropdownOpen(true);
  }, []);

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    longPressTriggeredRef.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      releaseGuardRef.current = true;
      ignoreNextContextMenuRef.current = true;
      setIsDropdownOpen(false);
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 600);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current && touchStartPos.current) {
      const dx = e.touches[0].clientX - touchStartPos.current.x;
      const dy = e.touches[0].clientY - touchStartPos.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }
  }, []);

  const handleLongPressEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;

    if (!longPressTriggeredRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    requestAnimationFrame(() => {
      longPressTriggeredRef.current = false;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (ignoreNextContextMenuRef.current) {
      ignoreNextContextMenuRef.current = false;
      return;
    }
    setShowMenu(true);
    setShowReactionPicker(true);
  }, []);

  useEffect(() => {
    const clearReleaseGuards = () => {
      releaseGuardRef.current = false;
      ignoreNextContextMenuRef.current = false;
    };

    const handlePointerCancel = () => {
      longPressTriggeredRef.current = false;
      releaseGuardRef.current = false;
      ignoreNextContextMenuRef.current = false;
    };

    window.addEventListener("pointerdown", clearReleaseGuards, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      window.removeEventListener("pointerdown", clearReleaseGuards, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!showReactionPicker || !bubbleRef.current) {
      setPickerPosition(null);
      return;
    }

    const updatePosition = () => {
      const bubble = bubbleRef.current;
      if (!bubble) return;

      const rect = bubble.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const rootStyles = getComputedStyle(document.documentElement);
      const bottomNavOffset = Number.parseFloat(rootStyles.getPropertyValue("--bottom-nav-offset")) || 0;

      const pickerWidth = Math.min(280, window.innerWidth - 16);
      const pickerHeight = 124;
      const topBoundary = viewportOffsetTop + 72;
      const composerSafeZone = 140;
      const bottomBoundary = viewportOffsetTop + viewportHeight - bottomNavOffset - composerSafeZone;
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

      setPickerPosition({ top, left });
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
  }, [isOwnMessage, showReactionPicker]);

  useLayoutEffect(() => {
    if (!showActionTrigger || !bubbleRef.current) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = bubbleRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.top,
        left: isOwnMessage ? rect.left - 36 : rect.right + 4,
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOwnMessage, showActionTrigger]);

  const profile = getProfile(msg.author_id);
  const displayName = profile?.display_name || msg.author?.display_name || "Loading...";
  const avatarUrl = profile?.avatar_url || msg.author?.avatar_url || undefined;
  const frontierReaders = readFrontier[msg.id] || [];

  return (
    <div
      id={`message-${msg.id}`}
      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"} ${
        highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
      }`}
    >
      <div className={`flex gap-2 max-w-[85%] group ${isOwnMessage ? "flex-row-reverse" : ""}`}>
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{displayName[0]?.toUpperCase() || "?"}</AvatarFallback>
        </Avatar>

        <div className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">{displayName}</span>
            {msg.id.startsWith("queued-") && (
              <span className="flex items-center text-amber-500" title="Pending sync">
                <Clock className="h-3 w-3" />
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {format(new Date(msg.created_at), "HH:mm")}
            </span>
          </div>

          {msg.reply_to && (
            <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1 border-l-2 border-primary">
              <span className="font-medium">{msg.reply_to.author?.display_name || "..."}: </span>
              <span className="line-clamp-1">{msg.reply_to.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}</span>
            </div>
          )}

          <div className="relative">
            <div
              ref={bubbleRef}
              className={`rounded-lg px-3 py-2 select-none ${
                isOwnMessage ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
              onTouchStart={handleLongPressStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleLongPressEnd}
              onContextMenu={handleContextMenu}
            >
              {msg.image_url && (
                <img src={msg.image_url} alt="Attachment" className="max-w-xs rounded mb-2" />
              )}
              <MessageContent text={msg.text} />
            </div>

            {showActionTrigger && menuPosition && createPortal(
              <div
                className="fixed z-[100002]"
                style={{ top: menuPosition.top, left: menuPosition.left }}
                data-menu-trigger="true"
              >
                <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 min-h-[32px] min-w-[32px] bg-background/80 backdrop-blur-sm shadow-sm"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (releaseGuardRef.current) {
                          e.preventDefault();
                        }
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (releaseGuardRef.current) return;
                        openActionMenu();
                      }}
                      onTouchStart={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align={isOwnMessage ? "end" : "start"}
                    side="top"
                    collisionPadding={16}
                    className="z-[100003] bg-popover border"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <DropdownMenuItem onClick={() => { handleReply(msg); closeActionUi(); }}>
                      <Reply className="h-4 w-4 mr-2" /> Reply
                    </DropdownMenuItem>
                    {isOwnMessage && (
                      <DropdownMenuItem onClick={() => { handleEdit(msg); closeActionUi(); }}>
                        <Pencil className="h-4 w-4 mr-2" /> Edit
                      </DropdownMenuItem>
                    )}
                    {(isOwnMessage || isAdmin) && (
                      <DropdownMenuItem
                        onClick={() => { setShowDeleteConfirm(true); closeActionUi(); }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>,
              document.body
            )}
          </div>

          {isOwnMessage && frontierReaders.length > 0 ? (
            <div className="cursor-pointer" onClick={() => setShowReadReceipts(true)}>
              <MessageReadAvatars readers={frontierReaders} isOwn={true} />
            </div>
          ) : isOwnMessage ? (
            <div className="mt-0.5">
              <span
                className={`text-[10px] text-muted-foreground ${(readCounts[msg.id] || 0) > 0 ? "cursor-pointer underline" : ""}`}
                onClick={(readCounts[msg.id] || 0) > 0 ? () => setShowReadReceipts(true) : undefined}
              >
                {(readCounts[msg.id] || 0) > 0 ? `Read by ${readCounts[msg.id]}` : "Sent"}
              </span>
            </div>
          ) : null}
          {isOwnMessage && (
            <ReadReceiptSheet
              open={showReadReceipts}
              onOpenChange={setShowReadReceipts}
              readers={frontierReaders}
              messageId={msg.id}
              messageType="group"
              contextId={groupId || msg.group_id}
              currentUserId={userId}
            />
          )}

          {messageReactions.length > 0 && (
            <GroupReactionBadges
              messageReactions={messageReactions}
              userId={userId}
              toggleReactionMutation={toggleReactionMutation}
              messageId={msg.id}
            />
          )}

          {showReactionPicker && pickerPosition && createPortal(
            <div
              className="fixed inset-0 z-[100001]"
              data-reaction-picker="true"
              onTouchStart={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  closeReactionPicker();
                }
              }}
              onTouchEnd={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  e.preventDefault();
                  closeReactionPicker();
                }
              }}
            >
              <div
                className="absolute"
                style={{ top: pickerPosition.top, left: pickerPosition.left, width: "min(280px, calc(100vw - 16px))" }}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="bg-popover border rounded-lg p-2 shadow-lg">
                  <div className="flex gap-1.5">
                    {REACTION_EMOJIS.map((emoji) => {
                      const userReaction = reactions.find(
                        (r) => r.group_message_id === msg.id && r.user_id === userId
                      );
                      const isSelected = userReaction?.reaction_type === emoji;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          className={`inline-flex items-center justify-center h-9 w-9 rounded-md text-lg shrink-0 active:bg-accent ${isSelected ? "bg-primary/20" : ""}`}
                          onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleReactionMutation.mutate({ messageId: msg.id, reactionType: emoji });
                            closeActionUi();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleReactionMutation.mutate({ messageId: msg.id, reactionType: emoji });
                            closeActionUi();
                          }}
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
                      closeActionUi();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeActionUi();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
});

function GroupReactionBadges({
  messageReactions,
  userId,
  toggleReactionMutation,
  messageId,
}: {
  messageReactions: any[];
  userId?: string;
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  messageId: string;
}) {
  const [openType, setOpenType] = useState<string | null>(null);

  const allUserIds = [...new Set(messageReactions.map((r: any) => r.user_id))];

  const { data: users = [] } = useQuery({
    queryKey: ["group-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", allUserIds);
      if (error) throw error;
      return data;
    },
    enabled: openType !== null && allUserIds.length > 0,
  });

  const grouped = messageReactions.reduce((acc: any, r: any) => {
    if (!acc[r.reaction_type]) acc[r.reaction_type] = [];
    acc[r.reaction_type].push(r);
    return acc;
  }, {} as Record<string, any[]>);

  const getUserName = (id: string) =>
    users.find((u: any) => u.id === id)?.display_name || "";

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
        const userReaction = items.find((r: any) => r.user_id === userId);
        return (
          <Popover
            key={type}
            open={openType === type}
            onOpenChange={(open) => setOpenType(open ? type : null)}
          >
            <PopoverTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenType(openType === type ? null : type);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                  userReaction ? "bg-primary/20 text-primary" : "bg-muted hover:bg-muted/80"
                }`}
              >
                <span>{type}</span>
                <span>{items.length}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-3 bg-popover border z-50"
              align="start"
              side="top"
              sideOffset={8}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-col gap-2 min-w-[140px]">
                <p className="text-xs font-medium text-muted-foreground">
                  {type} ({items.length})
                </p>
                {items.map((r: any) => (
                  <p key={r.id} className="text-sm">
                    {getUserName(r.user_id)}
                    {r.user_id === userId && " (you)"}
                  </p>
                ))}
                {userReaction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-destructive hover:text-destructive justify-start px-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleReactionMutation.mutate({ messageId, reactionType: type });
                      setOpenType(null);
                    }}
                  >
                    Remove your {type}
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
