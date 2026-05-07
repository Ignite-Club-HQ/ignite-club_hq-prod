import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { LinkPreview } from "./LinkPreview";
import { EmojiPicker } from "./EmojiPicker";
import { EventLinkCard } from "./EventLinkCard";
import { VaultFileCard } from "./VaultFileCard";
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
  /** Optional: enables a "GIF" tab in the emoji picker. Receives the selected GIF URL. */
  onGifSelect?: (gifUrl: string) => void;
}

interface SuggestedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Mention format: @[DisplayName](userId)
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:([0-9a-f-]{36})\]/gi;

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s]+/g;

/**
 * Parse raw value into segments of plain text and mentions.
 * Each mention segment includes its raw string, display text, and position in the raw string.
 */
interface RawSegment {
  type: "text" | "mention" | "event" | "vault-file" | "vault-folder" | "vault-root";
  raw: string;       // the raw string in value
  display: string;   // what the user sees: for mentions it's "@DisplayName"
  rawStart: number;  // start index in raw value
  rawEnd: number;    // end index in raw value
  userId?: string;
  displayName?: string;
  eventId?: string;
  vaultId?: string;
  vaultRootScope?: "team" | "club";
}

function parseRawValue(raw: string): RawSegment[] {
  const segments: RawSegment[] = [];
  // Order: mention, event, vaultroot, vaultfolder, vault file
  const regex = /(@\[([^\]]+)\]\(([^)]+)\))|(\[event:([0-9a-f-]{36})\])|(\[vaultroot:(team|club):([0-9a-f-]{36})\])|(\[vaultfolder:([0-9a-f-]{36})\])|(\[vault:([0-9a-f-]{36})\])/gi;
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

    if (match[1]) {
      segments.push({
        type: "mention",
        raw: match[0],
        display: `@${match[2]}`,
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        userId: match[3],
        displayName: match[2],
      });
    } else if (match[4]) {
      segments.push({
        type: "event",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        eventId: match[5],
      });
    } else if (match[6]) {
      const scope = (match[7] || "").toLowerCase() as "team" | "club";
      segments.push({
        type: "vault-root",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[8],
        vaultRootScope: scope,
      });
    } else if (match[9]) {
      segments.push({
        type: "vault-folder",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[10],
      });
    } else if (match[11]) {
      segments.push({
        type: "vault-file",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[12],
      });
    }

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
      if (seg.type !== "text") {
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
      if (seg.type !== "text") {
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
    if (seg.type !== "text") {
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
      if (seg.type !== "text") {
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
      if (seg.type !== "text") {
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
  onGifSelect,
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

  const hasEventToken = useMemo(() => /\[event:[0-9a-f-]{36}\]/i.test(value), [value]);
  const hasVaultToken = useMemo(
    () => /\[(?:vault|vaultfolder|vaultroot:(?:team|club)):[0-9a-f-]{36}\]/i.test(value),
    [value],
  );
  const hideTextareaPlaceholder = hasEventToken || hasVaultToken;

  const eventIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[event:([0-9a-f-]{36})\]/gi), (match) => match[1]).filter(Boolean))].slice(0, 3),
    [value]
  );

  const vaultFileIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[vault:([0-9a-f-]{36})\]/gi), (m) => m[1]).filter(Boolean))].slice(0, 3),
    [value],
  );
  const vaultFolderIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[vaultfolder:([0-9a-f-]{36})\]/gi), (m) => m[1]).filter(Boolean))].slice(0, 3),
    [value],
  );
  const vaultRoots = useMemo(() => {
    const seen = new Set<string>();
    const out: { scope: "team" | "club"; id: string }[] = [];
    for (const m of value.matchAll(/\[vaultroot:(team|club):([0-9a-f-]{36})\]/gi)) {
      const scope = (m[1] || "").toLowerCase() as "team" | "club";
      const id = (m[2] || "").toLowerCase();
      const key = `${scope}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ scope, id });
      }
    }
    return out.slice(0, 3);
  }, [value]);

  const removeEventToken = useCallback((eventId: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[event:${eventId}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);

  const removeVaultFileToken = useCallback((id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vault:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);
  const removeVaultFolderToken = useCallback((id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vaultfolder:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);
  const removeVaultRootToken = useCallback((scope: "team" | "club", id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vaultroot:${scope}:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);

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
      isEvent: seg.type === "event",
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
      // On iOS native, Enter should insert a newline (matches iMessage / WhatsApp).
      // Sending is done via the explicit Send button. On desktop, Enter still sends
      // and Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey && !isNativeIOS && onKeyPress) {
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
  }, [showSuggestions, users, selectedIndex, insertMention, onKeyPress, isNativeIOS]);

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
    <div ref={containerRef} className="relative flex-1 min-w-0 max-w-full self-end space-y-2 ml-1">
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

      {eventIds.length > 0 && (
        <div className="w-full min-w-0 max-w-full space-y-2">
          {eventIds.map((eventId) => (
            <div key={eventId} className="flex items-start gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <EventLinkCard eventId={eventId} />
              </div>
              <button
                type="button"
                onClick={() => removeEventToken(eventId)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {(vaultRoots.length > 0 || vaultFolderIds.length > 0 || vaultFileIds.length > 0) && (
        <div className="w-full min-w-0 max-w-full space-y-2">
          {vaultRoots.map((r) => (
            <div key={`vr-${r.scope}-${r.id}`} className="flex items-start gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard rootScope={r.scope} rootId={r.id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultRootToken(r.scope, r.id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
          {vaultFolderIds.map((id) => (
            <div key={`vf-${id}`} className="flex items-start gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard folderId={id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultFolderToken(id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
          {vaultFileIds.map((id) => (
            <div key={`vfile-${id}`} className="flex items-start gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard fileId={id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultFileToken(id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex w-full min-w-0 max-w-full items-center overflow-hidden rounded-2xl bg-muted/55 dark:bg-muted/40 pl-0.5 pr-1 min-h-[36px] ring-0 focus-within:bg-muted/70 dark:focus-within:bg-muted/55 focus-within:ring-1 focus-within:ring-ring/40 transition-[background-color,box-shadow] duration-150">
        {showEmojiPicker && (
          <div className="flex items-center h-9 -mr-0.5 transition-all duration-200 animate-in fade-in zoom-in-95">
            <EmojiPicker onEmojiSelect={handleEmojiSelect} onGifSelect={onGifSelect} disabled={disabled} />
          </div>
        )}
        <div className="relative flex-1 min-w-0 max-w-full overflow-hidden">
          {/* Highlight overlay for mentions */}
          {!isNativeIOS && (
            <div
              ref={highlightRef}
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none overflow-hidden pl-1 pr-1.5 py-[7px] text-[15px] leading-[1.4] whitespace-pre-wrap break-words text-transparent"
              style={{ maxHeight: '120px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {highlightedSegments.map((seg) =>
                seg.isMention ? (
                  <span key={seg.key} className="rounded px-0.5 bg-primary/15 text-transparent">{seg.text}</span>
                ) : (
                  <span key={seg.key}>{seg.text}</span>
                )
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
            placeholder={hideTextareaPlaceholder ? "" : placeholder}
            rows={1}
            wrap="soft"
            autoComplete="off"
            autoCorrect="on"
            spellCheck
            enterKeyHint="enter"
            aria-label={placeholder || "Message"}
            aria-multiline="true"
            role="textbox"
            className={`relative w-full min-w-0 max-w-full resize-none break-words border-none bg-transparent pl-1 pr-1.5 py-[7px] text-[15px] leading-[1.4] outline-none placeholder:text-foreground/35 placeholder:font-normal dark:placeholder:text-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 ${hideTextareaPlaceholder ? "font-medium" : ""} ${className || ''}`}
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
