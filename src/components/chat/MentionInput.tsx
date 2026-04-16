import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { LinkPreview } from "./LinkPreview";
import { EmojiPicker } from "./EmojiPicker";
import { Capacitor } from "@capacitor/core";

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyPress?: (e: React.KeyboardEvent) => void;
  onInputChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  teamId?: string;
  clubId?: string;
  groupId?: string;
  showEmojiPicker?: boolean;
}

interface SuggestedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Mention format: @[DisplayName](userId)
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s]+/g;

/**
 * Parse raw value into segments of plain text and mentions.
 * Each mention segment includes its raw string, display text, and position in the raw string.
 */
interface RawSegment {
  type: "text" | "mention";
  raw: string;       // the raw string in value
  display: string;   // what the user sees: for mentions it's "@DisplayName"
  rawStart: number;  // start index in raw value
  rawEnd: number;    // end index in raw value
  userId?: string;
  displayName?: string;
}

function parseRawValue(raw: string): RawSegment[] {
  const segments: RawSegment[] = [];
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  let lastEnd = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastEnd) {
      const textPart = raw.slice(lastEnd, match.index);
      segments.push({
        type: "text",
        raw: textPart,
        display: textPart,
        rawStart: lastEnd,
        rawEnd: match.index,
      });
    }
    segments.push({
      type: "mention",
      raw: match[0],
      display: `@${match[1]}`,  // Show @ prefix for mentions
      rawStart: match.index,
      rawEnd: match.index + match[0].length,
      userId: match[2],
      displayName: match[1],
    });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < raw.length) {
    segments.push({
      type: "text",
      raw: raw.slice(lastEnd),
      display: raw.slice(lastEnd),
      rawStart: lastEnd,
      rawEnd: raw.length,
    });
  }

  return segments;
}

function segmentsToDisplay(segments: RawSegment[]): string {
  return segments.map(s => s.display).join("");
}

/**
 * Convert a cursor position in display space to raw space.
 */
function displayToRawCursor(segments: RawSegment[], displayPos: number): number {
  let dispAccum = 0;
  for (const seg of segments) {
    const segDisplayLen = seg.display.length;
    if (dispAccum + segDisplayLen >= displayPos) {
      if (seg.type === "mention") {
        // If cursor is within a mention display, snap to start or end
        const offset = displayPos - dispAccum;
        return offset <= segDisplayLen / 2 ? seg.rawStart : seg.rawEnd;
      }
      return seg.rawStart + (displayPos - dispAccum);
    }
    dispAccum += segDisplayLen;
  }
  return segments.length > 0 ? segments[segments.length - 1].rawEnd : 0;
}

/**
 * Convert a cursor position in raw space to display space.
 */
function rawToDisplayCursor(segments: RawSegment[], rawPos: number): number {
  let dispAccum = 0;
  for (const seg of segments) {
    if (rawPos <= seg.rawStart) {
      return dispAccum;
    }
    if (rawPos < seg.rawEnd) {
      if (seg.type === "mention") {
        return dispAccum; // snap to start of mention
      }
      return dispAccum + (rawPos - seg.rawStart);
    }
    dispAccum += seg.display.length;
  }
  return dispAccum;
}

/**
 * Given old raw value, old segments, and a new display string + cursor,
 * reconstruct the new raw value preserving mentions that weren't edited.
 */
function reconstructRawFromDisplayEdit(
  oldSegments: RawSegment[],
  oldDisplay: string,
  newDisplay: string,
  cursorInNewDisplay: number
): string {
  // Simple diff: find common prefix and suffix between old and new display
  let prefixLen = 0;
  while (
    prefixLen < oldDisplay.length &&
    prefixLen < newDisplay.length &&
    oldDisplay[prefixLen] === newDisplay[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldDisplay.length - prefixLen &&
    suffixLen < newDisplay.length - prefixLen &&
    oldDisplay[oldDisplay.length - 1 - suffixLen] === newDisplay[newDisplay.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldEditStart = prefixLen;
  const oldEditEnd = oldDisplay.length - suffixLen;
  const newEditStart = prefixLen;
  const newEditEnd = newDisplay.length - suffixLen;
  const insertedText = newDisplay.slice(newEditStart, newEditEnd);

  // Map display positions to raw positions
  const rawEditStart = displayToRawCursor(oldSegments, oldEditStart);
  const rawEditEnd = displayToRawCursor(oldSegments, oldEditEnd);

  // Check if edit range covers any mentions partially or fully
  // If a mention is partially in the edit range, remove the entire mention
  let actualRawStart = rawEditStart;
  let actualRawEnd = rawEditEnd;

  for (const seg of oldSegments) {
    if (seg.type === "mention") {
      // If the edit overlaps with this mention at all, remove the entire mention
      if (seg.rawStart < actualRawEnd && seg.rawEnd > actualRawStart) {
        actualRawStart = Math.min(actualRawStart, seg.rawStart);
        actualRawEnd = Math.max(actualRawEnd, seg.rawEnd);
      }
    }
  }

  // Rebuild: prefix raw + inserted text + suffix raw
  const rawBefore = oldSegments.length > 0
    ? oldSegments[0].raw.length > 0
      ? getRawUpTo(oldSegments, actualRawStart)
      : ""
    : "";
  const rawAfter = getRawFrom(oldSegments, actualRawEnd);

  return rawBefore + insertedText + rawAfter;
}

function getRawUpTo(segments: RawSegment[], rawPos: number): string {
  let result = "";
  for (const seg of segments) {
    if (seg.rawEnd <= rawPos) {
      result += seg.raw;
    } else if (seg.rawStart < rawPos) {
      if (seg.type === "mention") {
        // Don't include partial mentions
      } else {
        result += seg.raw.slice(0, rawPos - seg.rawStart);
      }
      break;
    } else {
      break;
    }
  }
  return result;
}

function getRawFrom(segments: RawSegment[], rawPos: number): string {
  let result = "";
  for (const seg of segments) {
    if (seg.rawStart >= rawPos) {
      result += seg.raw;
    } else if (seg.rawEnd > rawPos) {
      if (seg.type === "mention") {
        // Don't include partial mentions
      } else {
        result += seg.raw.slice(rawPos - seg.rawStart);
      }
    }
  }
  return result;
}

export function MentionInput({
  value,
  onChange,
  onKeyPress,
  onInputChange,
  disabled,
  placeholder,
  className,
  teamId,
  clubId,
  groupId,
  showEmojiPicker = true,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1); // in display space
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

  // Parse segments from raw value
  const segments = useMemo(() => parseRawValue(value), [value]);
  const displayValue = useMemo(() => segmentsToDisplay(segments), [segments]);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 120;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const detectedUrls = useMemo(() => {
    const matches = value.match(URL_REGEX) || [];
    return [...new Set(matches)].slice(0, 3);
  }, [value]);

  // Fetch users based on team/club/group context
  const { data: users } = useQuery({
    queryKey: ["mention-users", teamId, clubId, groupId, mentionSearch],
    queryFn: async () => {
      let userIds: string[] = [];

      if (groupId) {
        const { data: group } = await supabase
          .from("chat_groups")
          .select("team_id, club_id")
          .eq("id", groupId)
          .single();

        if (group?.team_id) {
          const { data: roles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", group.team_id);
          userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
        } else if (group?.club_id) {
          const { data: roles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", group.club_id);
          userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
        }
      } else if (teamId) {
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

  // Highlighted segments for the overlay
  const highlightedSegments = useMemo(() => {
    return segments.map((seg, i) => ({
      text: seg.display,
      isMention: seg.type === "mention",
      key: i,
    }));
  }, [segments]);

  // Check for @ mention trigger in display text
  const checkForMentionTrigger = useCallback((text: string, cursorPos: number) => {
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Don't trigger if there's a space or newline after @
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        // Check if this @ is part of an existing mention display (e.g. "@John")
        // We need to verify this isn't an already-completed mention
        let isMentionDisplay = false;
        let dispAccum = 0;
        for (const seg of segments) {
          if (seg.type === "mention") {
            const mentionStart = dispAccum;
            const mentionEnd = dispAccum + seg.display.length;
            if (lastAtIndex >= mentionStart && lastAtIndex < mentionEnd) {
              isMentionDisplay = true;
              break;
            }
          }
          dispAccum += seg.display.length;
        }

        if (!isMentionDisplay) {
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
  }, [segments]);

  const handleDisplayChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDisplay = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    if (newDisplay === displayValue) return;

    // Reconstruct raw value from display edit
    const newRaw = reconstructRawFromDisplayEdit(segments, displayValue, newDisplay, cursorPos);

    onChange(newRaw);
    adjustHeight();

    // Check for mention trigger
    checkForMentionTrigger(newDisplay, cursorPos);
  }, [segments, displayValue, onChange, adjustHeight, checkForMentionTrigger]);

  const insertMention = useCallback((user: SuggestedUser) => {
    if (mentionStartIndex === -1 || !user.display_name) return;

    // mentionStartIndex is in display space, pointing to the "@"
    // We need to replace from "@" + mentionSearch in raw space
    const rawStartIndex = displayToRawCursor(segments, mentionStartIndex);

    // The raw text at this position should be "@" + mentionSearch
    const rawMention = `@[${user.display_name}](${user.id}) `;

    // Calculate what to remove: the "@" + search text
    const removeLength = 1 + mentionSearch.length; // "@" + search text
    const rawEndIndex = rawStartIndex + removeLength;

    const newRaw = value.slice(0, rawStartIndex) + rawMention + value.slice(rawEndIndex);

    onChange(newRaw);
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);

    // Focus and set cursor after the inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newSegments = parseRawValue(newRaw);
        const newDisplayVal = segmentsToDisplay(newSegments);
        // Find cursor position after the mention + space
        const rawCursorPos = rawStartIndex + rawMention.length;
        const displayCursorPos = rawToDisplayCursor(newSegments, rawCursorPos);
        inputRef.current.setSelectionRange(displayCursorPos, displayCursorPos);
      }
    }, 0);
  }, [mentionStartIndex, mentionSearch, value, onChange, segments]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || !users || users.length === 0) {
      if (e.key === "Enter" && !e.shiftKey && onKeyPress) {
        e.preventDefault();
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
  }, [showSuggestions, users, selectedIndex, insertMention, onKeyPress]);

  // Close suggestions when clicking outside (but not inside our component)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleEmojiSelect = useCallback((emoji: string) => {
    const cursorPos = inputRef.current?.selectionStart || displayValue.length;
    // Convert display cursor to raw cursor for insertion
    const rawCursorPos = displayToRawCursor(segments, cursorPos);
    const newValue = value.slice(0, rawCursorPos) + emoji + value.slice(rawCursorPos);
    onChange(newValue);

    setTimeout(() => {
      if (isNativeIOS) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      inputRef.current?.focus();
      const newSegments = parseRawValue(newValue);
      const newDisplayCursor = rawToDisplayCursor(newSegments, rawCursorPos + emoji.length);
      inputRef.current?.setSelectionRange(newDisplayCursor, newDisplayCursor);
    }, 0);
  }, [value, onChange, isNativeIOS, segments, displayValue]);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 max-w-full self-end space-y-2">
      {/* URL Previews */}
      {detectedUrls.length > 0 && (
        <div className="w-full min-w-0 max-w-full max-h-28 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
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

      <div className="flex w-full min-w-0 max-w-full items-center overflow-hidden rounded-[22px] bg-muted/60 px-1 min-h-[44px] transition-all duration-150">
        {showEmojiPicker && (
          <div className="flex items-center h-[44px]">
            <EmojiPicker onEmojiSelect={handleEmojiSelect} disabled={disabled} />
          </div>
        )}
        <div className="relative flex-1 min-w-0 max-w-full overflow-hidden">
          {/* Highlight overlay for mentions */}
          {!isNativeIOS && (
            <div
              ref={highlightRef}
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none overflow-hidden px-2 pt-[13px] pb-[7px] text-base leading-[1.4] whitespace-pre-wrap break-words text-transparent"
              style={{ maxHeight: '120px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {highlightedSegments.map((seg) =>
                seg.isMention
                  ? <span key={seg.key} className="bg-primary/15 rounded px-0.5 text-transparent">{seg.text}</span>
                  : <span key={seg.key}>{seg.text}</span>
              )}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={displayValue}
            onChange={handleDisplayChange}
            onKeyDown={handleKeyDown}
            onScroll={() => {
              if (highlightRef.current && inputRef.current) {
                highlightRef.current.scrollTop = inputRef.current.scrollTop;
              }
            }}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            wrap="soft"
            autoComplete="off"
            autoCorrect="on"
            spellCheck
            className={`relative w-full min-w-0 max-w-full resize-none break-words border-none bg-transparent px-2 pt-[13px] pb-[7px] text-base leading-[1.4] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`}
            style={{ width: '100%', maxHeight: '120px', maxWidth: '100%', overflowX: 'hidden', overflowY: 'hidden', overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box', WebkitUserSelect: 'text', userSelect: 'text', WebkitTouchCallout: 'default', touchAction: 'auto' } as React.CSSProperties}
          />
        </div>
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
