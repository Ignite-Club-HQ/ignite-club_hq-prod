import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { LinkPreview } from "./LinkPreview";
import { EmojiPicker } from "./EmojiPicker";

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyPress?: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  teamId?: string;
  clubId?: string;
  showEmojiPicker?: boolean;
}

interface SuggestedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s]+/g;

export function MentionInput({
  value,
  onChange,
  onKeyPress,
  disabled,
  placeholder,
  className,
  teamId,
  clubId,
  showEmojiPicker = true,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect URLs in the input
  const detectedUrls = useMemo(() => {
    const matches = value.match(URL_REGEX) || [];
    return [...new Set(matches)].slice(0, 3); // Max 3 previews
  }, [value]);

  // Fetch users based on team/club context
  const { data: users } = useQuery({
    queryKey: ["mention-users", teamId, clubId, mentionSearch],
    queryFn: async () => {
      let userIds: string[] = [];
      
      if (teamId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId);
        userIds = roles?.map((r) => r.user_id) || [];
      } else if (clubId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId);
        userIds = roles?.map((r) => r.user_id) || [];
      }
      
      if (userIds.length === 0) {
        // Fallback to all profiles if no context
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .not("display_name", "is", null)
          .ilike("display_name", `%${mentionSearch}%`)
          .limit(5);
        return data as SuggestedUser[];
      }
      
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds)
        .not("display_name", "is", null)
        .ilike("display_name", `%${mentionSearch}%`)
        .limit(5);
        
      return data as SuggestedUser[];
    },
    enabled: showSuggestions && mentionSearch.length >= 0,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;
    
    onChange(newValue);
    
    // Check for @ trigger
    const textBeforeCursor = newValue.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space between @ and cursor (means mention was completed or cancelled)
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        setShowSuggestions(true);
        setMentionSearch(textAfterAt);
        setMentionStartIndex(lastAtIndex);
        setSelectedIndex(0);
        return;
      }
    }
    
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);
  };

  // Convert raw value (with IDs) to display value (without IDs)
  const rawToDisplay = useCallback((raw: string) => {
    return raw.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
  }, []);

  // Store mapping of display mentions to raw mentions
  const mentionMap = useMemo(() => {
    const map = new Map<string, string>();
    const matches = value.matchAll(/@\[([^\]]+)\]\(([^)]+)\)/g);
    for (const match of matches) {
      map.set(`@${match[1]}`, match[0]);
    }
    return map;
  }, [value]);

  const displayValue = useMemo(() => rawToDisplay(value), [value, rawToDisplay]);

  // Convert display index to raw index
  const displayIndexToRawIndex = useCallback((displayIdx: number) => {
    let rawIdx = 0;
    let dispIdx = 0;
    const mentionRegex = /@\[([^\]]+)\]\([^)]+\)/g;
    let lastEnd = 0;
    let match;
    
    while ((match = mentionRegex.exec(value)) !== null) {
      const beforeMention = value.slice(lastEnd, match.index);
      // Count chars before this mention
      if (dispIdx + beforeMention.length >= displayIdx) {
        // Target is before this mention
        return rawIdx + (displayIdx - dispIdx);
      }
      dispIdx += beforeMention.length;
      rawIdx += beforeMention.length;
      
      // The mention displays as @Name (match[1].length + 1 for @)
      const displayMentionLen = match[1].length + 1;
      const rawMentionLen = match[0].length;
      
      if (dispIdx + displayMentionLen > displayIdx) {
        // Target is within this mention - return start of mention
        return rawIdx;
      }
      
      dispIdx += displayMentionLen;
      rawIdx += rawMentionLen;
      lastEnd = match.index + match[0].length;
    }
    
    // Handle remaining text after last mention
    const remaining = value.slice(lastEnd);
    return rawIdx + Math.min(displayIdx - dispIdx, remaining.length);
  }, [value]);

  const insertMention = useCallback((user: SuggestedUser) => {
    if (mentionStartIndex === -1 || !user.display_name) return;
    
    // Convert display index to raw index
    const rawStartIndex = displayIndexToRawIndex(mentionStartIndex);
    
    // Build the new raw value
    const rawMention = `@[${user.display_name}](${user.id}) `;
    
    // Get parts of raw value
    const beforeRaw = value.slice(0, rawStartIndex);
    const afterRaw = value.slice(rawStartIndex + mentionSearch.length + 1);
    
    const newRaw = beforeRaw + rawMention + afterRaw;
    
    onChange(newRaw);
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);
    
    // Focus back on input
    inputRef.current?.focus();
  }, [mentionStartIndex, mentionSearch, value, onChange, displayIndexToRawIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || !users || users.length === 0) {
      if (e.key === "Enter" && !e.shiftKey && onKeyPress) {
        onKeyPress(e);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % users.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + users.length) % users.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (users[selectedIndex]) {
        insertMention(users[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowSuggestions(false);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleDisplayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDisplay = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    
    if (newDisplay === displayValue) return;
    
    // Convert display value back to raw value
    let newRaw = newDisplay;
    
    // Restore any mentions that still exist in the new display value
    mentionMap.forEach((rawMention, displayMention) => {
      if (newRaw.includes(displayMention)) {
        // Only replace the first occurrence to handle duplicates correctly
        newRaw = newRaw.replace(displayMention, rawMention);
      }
    });
    
    onChange(newRaw);
    
    // Check for @ trigger
    const textBeforeCursor = newDisplay.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        // Check if this @ is part of an existing completed mention
        const mentionAtCursor = `@${textAfterAt}`;
        const isExistingMention = mentionMap.has(mentionAtCursor);
        
        if (!isExistingMention) {
          setShowSuggestions(true);
          setMentionSearch(textAfterAt);
          setMentionStartIndex(lastAtIndex);
          setSelectedIndex(0);
          return;
        }
      }
    }
    
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);
  };

  const handleEmojiSelect = useCallback((emoji: string) => {
    const cursorPos = inputRef.current?.selectionStart || value.length;
    const newValue = value.slice(0, cursorPos) + emoji + value.slice(cursorPos);
    onChange(newValue);
    // Focus back and set cursor after emoji
    setTimeout(() => {
      inputRef.current?.focus();
      const newPos = cursorPos + emoji.length;
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }, [value, onChange]);

  return (
    <div className="relative flex-1 space-y-2">
      {/* URL Previews */}
      {detectedUrls.length > 0 && (
        <div className="space-y-2">
          {detectedUrls.map((url) => (
            <LinkPreview
              key={url}
              url={url}
              compact
              onRemove={() => onChange(value.replace(url, "").trim())}
            />
          ))}
        </div>
      )}
      
      <div className="flex items-center gap-1">
        {showEmojiPicker && (
          <EmojiPicker onEmojiSelect={handleEmojiSelect} disabled={disabled} />
        )}
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={handleDisplayChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className={className}
        />
      </div>
      
      {showSuggestions && users && users.length > 0 && (
        <div 
          className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg overflow-hidden z-50"
          onClick={(e) => e.stopPropagation()}
        >
          {users.map((user, index) => (
            <button
              key={user.id}
              className={`w-full flex items-center gap-2 p-2 text-left hover:bg-accent transition-colors ${
                index === selectedIndex ? "bg-accent" : ""
              }`}
              onClick={() => insertMention(user)}
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.avatar_url || undefined} />
                <AvatarFallback className="text-xs">
                  {user.display_name?.[0] || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">{user.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}