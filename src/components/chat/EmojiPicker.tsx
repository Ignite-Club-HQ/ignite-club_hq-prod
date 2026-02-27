import { useState, useEffect, useCallback, useRef } from "react";
import { Smile, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { Capacitor } from "@capacitor/core";

const RECENT_EMOJIS_KEY = "ignite-recent-emojis";
const MAX_RECENT_EMOJIS = 14;

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😊",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐"],
  },
  {
    name: "Gestures",
    icon: "👋",
    emojis: ["👋", "🤚", "🖐", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "💪", "🦾"],
  },
  {
    name: "Hearts",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💝"],
  },
  {
    name: "Sports",
    icon: "⚽",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🥅", "⛳", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🏋️", "🤺", "⛷️", "🏂", "🏌️", "🏇", "⛹️", "🏊", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹", "🧗", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️"],
  },
  {
    name: "Celebration",
    icon: "🎉",
    emojis: ["🎉", "🎊", "🎈", "🎁", "🎀", "🎂", "🍰", "🧁", "🥳", "🪅", "🎆", "🎇", "✨", "🎄", "🎃", "👻", "🎅", "🤶", "🧑‍🎄"],
  },
  {
    name: "Objects",
    icon: "🔥",
    emojis: ["🔥", "💯", "✅", "❌", "⭐", "🌟", "💫", "⚡", "💥", "💢", "💨", "💦", "💤", "🎵", "🎶", "🔔", "📣", "📢", "💬", "💭", "🗯️", "♠️", "♣️", "♥️", "♦️", "🃏", "🎴", "🎰"],
  },
];

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
}

function getRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string) {
  try {
    const recent = getRecentEmojis().filter(e => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_EMOJIS)));
  } catch {
    // Ignore storage errors
  }
}

export function EmojiPicker({ onEmojiSelect, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const isMobile = useIsMobile();
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const onEmojiSelectRef = useRef(onEmojiSelect);
  
  // Keep ref updated
  useEffect(() => {
    onEmojiSelectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);

  useEffect(() => {
    if (open) {
      setRecentEmojis(getRecentEmojis());
    }
  }, [open]);

  const handleEmojiClick = useCallback((emoji: string) => {
    // Save to recent first
    saveRecentEmoji(emoji);
    // Call the callback using ref to avoid stale closure
    onEmojiSelectRef.current(emoji);
    // Close popover after a tiny delay to ensure the callback fires
    requestAnimationFrame(() => {
      setOpen(false);
    });
  }, []);

  // Unified handler for both touch and click
  const createEmojiHandler = useCallback((emoji: string) => {
    return (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleEmojiClick(emoji);
    };
  }, [handleEmojiClick]);

  return (
    <Popover open={open} onOpenChange={(newOpen) => {
      if (newOpen && isNativeIOS) {
        // Blur active input to dismiss iOS keyboard & accessory bar before opening
        (document.activeElement as HTMLElement)?.blur();
      }
      setOpen(newOpen);
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={disabled}
        >
          <Smile className="h-5 w-5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className={`p-2 ${isMobile ? "w-[calc(100vw-2rem)] max-w-sm" : "w-72"}`}
        side="top" 
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          // Only close if clicking outside
          const target = e.target as HTMLElement;
          if (!target.closest('[data-emoji-button]')) {
            setOpen(false);
          }
        }}
      >
        {/* Recent emojis row */}
        {recentEmojis.length > 0 && (
          <div className="mb-2 pb-2 border-b">
            <div className="flex items-center gap-1 mb-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Recent</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {recentEmojis.map((emoji, idx) => (
                <button
                  type="button"
                  key={`recent-${emoji}-${idx}`}
                  data-emoji-button
                  onClick={createEmojiHandler(emoji)}
                  onTouchEnd={createEmojiHandler(emoji)}
                  className={`flex items-center justify-center hover:bg-accent active:bg-accent rounded transition-colors cursor-pointer select-none touch-manipulation ${
                    isMobile ? "h-9 w-9 text-xl" : "h-7 w-7 text-base"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs - use icons on mobile */}
        <div className="flex gap-1 mb-2 pb-1 border-b overflow-x-auto scrollbar-hide">
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <button
              type="button"
              key={cat.name}
              onClick={() => setActiveCategory(idx)}
              className={`shrink-0 rounded transition-colors ${
                isMobile 
                  ? "h-8 w-8 flex items-center justify-center text-lg" 
                  : "px-2 py-1 text-xs whitespace-nowrap"
              } ${
                activeCategory === idx 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-accent text-muted-foreground"
              }`}
              title={cat.name}
            >
              {isMobile ? cat.icon : cat.name}
            </button>
          ))}
        </div>
        
        {/* Emoji grid - larger touch targets on mobile */}
        <div className={`grid gap-1 max-h-52 overflow-y-auto ${
          isMobile ? "grid-cols-7" : "grid-cols-8"
        }`}>
          {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
            <button
              type="button"
              key={emoji}
              data-emoji-button
              onClick={createEmojiHandler(emoji)}
              onTouchEnd={createEmojiHandler(emoji)}
              className={`flex items-center justify-center hover:bg-accent active:bg-accent rounded transition-colors select-none touch-manipulation ${
                isMobile ? "h-10 w-10 text-xl" : "h-8 w-8 text-lg"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
