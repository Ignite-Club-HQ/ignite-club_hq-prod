import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MoreVertical, Pencil, Trash2, Reply, SmilePlus, Clock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const closeActionUi = useCallback(() => {
    setShowMenu(false);
    setShowReactionPicker(false);
    setIsDropdownOpen(false);
  }, []);

  const handleDropdownOpenChange = useCallback((open: boolean) => {
    setIsDropdownOpen(open);
    if (!open && !showReactionPicker) {
      setShowMenu(false);
    }
  }, [showReactionPicker]);

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
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

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowMenu(true);
    setShowReactionPicker(true);
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // Close menu/reactions on outside tap
  useEffect(() => {
    if ((!showMenu && !showReactionPicker) || isDropdownOpen) return;
    const timer = setTimeout(() => {
      document.addEventListener("touchstart", closeActionUi);
      document.addEventListener("click", closeActionUi);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("touchstart", closeActionUi);
      document.removeEventListener("click", closeActionUi);
    };
  }, [showMenu, showReactionPicker, isDropdownOpen, closeActionUi]);

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
              <span className="line-clamp-1">{msg.reply_to.text}</span>
            </div>
          )}

          <div
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

          {/* Read indicator */}
          {isOwnMessage && frontierReaders.length > 0 ? (
            <MessageReadAvatars readers={frontierReaders} isOwn={true} />
          ) : isOwnMessage ? (
            <div className="mt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {(readCounts[msg.id] || 0) > 0 ? `Read by ${readCounts[msg.id]}` : "Sent"}
              </span>
            </div>
          ) : null}

          {/* Always-visible reaction badges */}
          {messageReactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {messageReactions.map((r) => (
                <span key={r.id} className="text-xs bg-muted px-1 rounded">
                  {r.reaction_type}
                </span>
              ))}
            </div>
          )}

          {/* Reaction picker - only on long press */}
          {showReactionPicker && (
            <div className="mt-1" onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
              <div className="bg-popover border rounded-lg p-2 shadow-lg">
                <div className="flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => {
                    const userReaction = reactions.find(
                      (r) => r.group_message_id === msg.id && r.user_id === userId
                    );
                    const isSelected = userReaction?.reaction_type === emoji;
                    return (
                      <Button
                        key={emoji}
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 ${isSelected ? "bg-primary/20 ring-2 ring-primary" : ""}`}
                        onClick={() => {
                          toggleReactionMutation.mutate({ messageId: msg.id, reactionType: emoji });
                          setShowReactionPicker(false);
                        }}
                      >
                        {emoji}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Three-dot button - visible after long press, opens dropdown on tap */}
        {showMenu && (
          <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDropdownOpen(true);
                }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isOwnMessage ? "end" : "start"} side="top" collisionPadding={16} className="bg-popover border">
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
                  onClick={() => { deleteMessageMutation.mutate(msg.id); closeActionUi(); }}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
});