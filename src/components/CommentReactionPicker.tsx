import { memo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "thumbsup", emoji: "👍" },
  { type: "sad", emoji: "😢" },
];

interface CommentReaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface CommentReactionPickerProps {
  isOpen: boolean;
  reactions: CommentReaction[];
  currentUserId?: string;
  onEmojiClick: (type: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLDivElement>;
}

export const CommentReactionPicker = memo(function CommentReactionPicker({
  isOpen,
  reactions,
  currentUserId,
  onEmojiClick,
  onClose,
  anchorRef,
}: CommentReactionPickerProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (isOpen && anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const pickerHeight = 52;
      const headerSafeZone = 60;
      const top = rect.top < headerSafeZone + pickerHeight
        ? rect.bottom + 4
        : rect.top - pickerHeight - 4;
      // Clamp left so picker doesn't overflow viewport
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280));
      setPosition({ top, left });
    } else {
      setPosition(null);
    }
  }, [isOpen, anchorRef]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-[100001]"
      style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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
                  onEmojiClick(type);
                }}
                aria-label={`React with ${type}${userHasReaction ? ' (selected)' : ''}`}
                aria-pressed={userHasReaction}
                className={`h-9 w-9 p-0 text-lg shrink-0 ${
                  userHasReaction ? "bg-primary/20" : ""
                }`}
              >
                {emoji}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
