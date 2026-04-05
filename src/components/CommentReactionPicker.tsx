import { memo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

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

  useLayoutEffect(() => {
    if (isOpen && anchorRef?.current) {
      const updatePosition = () => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const pickerHeight = 52;
        const headerSafeZone = 60;
        const top = rect.top < headerSafeZone + pickerHeight
          ? rect.bottom + 4
          : rect.top - pickerHeight - 4;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280));
        setPosition({ top, left });
      };

      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);

      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }

    if (!isOpen) {
      setPosition(null);
    }
  }, [isOpen, anchorRef]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100001]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="fixed"
        style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
        onPointerDown={(e) => e.stopPropagation()}
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
                onPointerUp={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onEmojiClick(type);
                }}
                aria-label={`React with ${type}${userHasReaction ? ' (selected)' : ''}`}
                aria-pressed={userHasReaction}
                className={`h-10 w-10 p-0 text-xl shrink-0 rounded-md flex items-center justify-center active:scale-110 transition-transform ${
                  userHasReaction ? "bg-primary/20" : "hover:bg-accent"
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
