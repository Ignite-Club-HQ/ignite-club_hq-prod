import { useMemo, memo, useState, useCallback, useRef, useEffect } from "react";
import { Play } from "lucide-react";
import { LinkPreview } from "./LinkPreview";
import { YouTubeEmbed, extractYouTubeId } from "./YouTubeEmbed";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { EventLinkCard } from "./EventLinkCard";
import { PollCard } from "./PollCard";
import { highlightText } from "./ChatSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { isVideoUrl } from "@/lib/videoUtils";

interface MessageContentProps {
  text: string;
  mentions?: { userId: string; displayName: string }[];
  imageUrl?: string | null;
  searchQuery?: string;
  showPreviews?: boolean;
  previewsOnly?: boolean;
  onReportImage?: () => void;
  onBlockImageAuthor?: () => void;
  showImageActions?: boolean;
}

// URL regex pattern - matches http(s):// or www. URLs
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s]+/gi;
// Mention regex pattern @[name](userId)
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;
// Markdown link pattern [text](url)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
// Event link pattern [event:uuid]
const EVENT_LINK_REGEX = /\[event:([0-9a-f-]{36})\]/gi;
// Event URL pattern - matches /events/uuid in URLs
const EVENT_URL_REGEX = /(?:https?:\/\/[^\s]*)?\/events\/([0-9a-f-]{36})/gi;
// Poll token pattern [poll:uuid]
const POLL_LINK_REGEX = /\[poll:([0-9a-f-]{36})\]/gi;

// Ensure URL has protocol for href
const ensureProtocol = (url: string): string => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
};

// Truncate a URL for display: show domain + ellipsis for long paths
const truncateUrl = (url: string, maxLength = 50): string => {
  if (url.length <= maxLength) return url;
  try {
    const parsed = new URL(ensureProtocol(url));
    const domain = parsed.hostname.replace(/^www\./, '');
    const pathStart = parsed.pathname.slice(0, 20);
    return `${domain}${pathStart}…`;
  } catch {
    return url.slice(0, maxLength) + '…';
  }
};

export const MessageContent = memo(function MessageContent({ text, imageUrl, searchQuery, showPreviews = true, previewsOnly = false, onReportImage, onBlockImageAuthor, showImageActions = false }: MessageContentProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Get signed URL for private chat attachments
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(imageUrl);
  const effectiveImageUrl = signedUrl || imageUrl;
  
  // Reset image state when URL changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [imageUrl]);
  
  // Check if image is already cached/loaded (for browser-cached images)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setImageLoaded(true);
    }
  }, [effectiveImageUrl]);
  
  const parts = useMemo(() => {
    if (!text) return [];
    
    const result: { type: "text" | "link" | "mention" | "markdown-link" | "event-link" | "poll-link"; content: string; userId?: string; linkText?: string }[] = [];
    let lastIndex = 0;
    
    // Combined regex. Order: poll tokens, event tokens, markdown links, event URLs, plain URLs, mentions
    const combinedRegex = /(\[poll:([0-9a-f-]{36})\])|(\[event:([0-9a-f-]{36})\])|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|((?:https?:\/\/[^\s]*)?\/events\/([0-9a-f-]{36})(?:\S*)?)|((?:https?:\/\/|www\.)[^\s\]]+)|(@\[([^\]]+)\]\(([^)]+)\))/gi;
    let match;
    
    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore) {
          result.push({ type: "text", content: textBefore });
        }
      }
      
      if (match[1]) {
        // Poll token: [poll:uuid] - match[2] is the poll ID
        result.push({ type: "poll-link", content: match[2] || "" });
      } else if (match[3]) {
        // Event token: [event:uuid] - match[4] is the event ID
        result.push({ type: "event-link", content: match[4] || "" });
      } else if (match[5]) {
        // Markdown link match: [text](url) - match[6] is text, match[7] is URL
        result.push({ 
          type: "markdown-link", 
          content: match[7] || "", 
          linkText: match[6] || "" 
        });
      } else if (match[8]) {
        // Event URL match: /events/uuid - match[9] is the event ID
        result.push({ type: "event-link", content: match[9] || "" });
      } else if (match[10]) {
        // Plain URL match
        result.push({ type: "link", content: match[10] });
      } else if (match[11]) {
        // Mention match - match[12] is display name, match[13] is userId
        result.push({ 
          type: "mention", 
          content: match[12] || "", 
          userId: match[13] || "" 
        });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining) {
        result.push({ type: "text", content: remaining });
      }
    }
    
    // If no matches found, return the entire text as a single part
    return result.length > 0 ? result : [{ type: "text" as const, content: text }];
  }, [text]);

  // Extract URLs and categorize them
  const { youtubeUrls, otherUrls, eventIds, pollIds } = useMemo(() => {
    const urls = [...new Set(parts.filter(p => p.type === "link").map(p => p.content))];
    const youtube: { url: string; videoId: string }[] = [];
    const other: string[] = [];
    const events = [...new Set(parts.filter(p => p.type === "event-link").map(p => p.content))];
    const polls = [...new Set(parts.filter(p => p.type === "poll-link").map(p => p.content))];

    for (const url of urls) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        youtube.push({ url, videoId });
      } else {
        other.push(url);
      }
    }

    return {
      youtubeUrls: youtube.slice(0, 2),
      otherUrls: other.slice(0, 2),
      eventIds: events.slice(0, 3),
      pollIds: polls.slice(0, 3),
    };
  }, [parts]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(true); // Hide skeleton on error too
  }, []);

  const [showFullscreen, setShowFullscreen] = useState(false);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (effectiveImageUrl) {
      setShowFullscreen(true);
    }
  }, [effectiveImageUrl]);

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // If previewsOnly, skip image and text rendering
  if (previewsOnly) {
    return (
      <>
        {/* Poll cards */}
        {pollIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {pollIds.map((pollId) => (
              <PollCard key={pollId} pollId={pollId} />
            ))}
          </div>
        )}

        {/* Event link cards */}
        {eventIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {eventIds.map((eventId) => (
              <EventLinkCard key={eventId} eventId={eventId} />
            ))}
          </div>
        )}

        {/* YouTube embeds */}
        {youtubeUrls.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {youtubeUrls.map(({ url, videoId }) => (
              <YouTubeEmbed key={url} videoId={videoId} compact />
            ))}
          </div>
        )}

        {/* Link previews for non-YouTube URLs */}
        {otherUrls.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {otherUrls.map((url) => (
              <LinkPreview key={url} url={url} compact />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-2 min-w-0 max-w-full">
      {/* Image / video attachment */}
      {imageUrl && !imageError && (
        <div className="rounded-lg overflow-hidden max-w-xs">
          {(!imageLoaded || isLoadingSignedUrl) && (
            <Skeleton className="w-48 h-32" />
          )}
          {!isLoadingSignedUrl && effectiveImageUrl && (
            isVideoUrl(effectiveImageUrl) ? (
              <div
                className={`relative cursor-pointer ${!imageLoaded ? 'hidden' : ''}`}
                onClick={handleImageClick}
              >
                <video
                  src={effectiveImageUrl}
                  className="w-full h-auto max-h-64 object-cover"
                  preload="metadata"
                  playsInline
                  muted
                  onLoadedData={handleImageLoad}
                  onError={handleImageError}
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="rounded-full bg-black/60 p-3">
                    <Play className="h-6 w-6 fill-white text-white" />
                  </div>
                </div>
              </div>
            ) : (
              <img
                ref={imgRef}
                src={effectiveImageUrl}
                alt="Attachment"
                className={`w-full h-auto max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity ${!imageLoaded ? 'hidden' : ''}`}
                onLoad={handleImageLoad}
                onError={handleImageError}
                onClick={handleImageClick}
              />
            )
          )}
        </div>
      )}

      {/* Fullscreen image viewer */}
      {showFullscreen && effectiveImageUrl && (
        <FullscreenImageViewer
          src={effectiveImageUrl}
          alt="Attachment"
          onClose={() => setShowFullscreen(false)}
          onReport={onReportImage}
          onBlockUser={onBlockImageAuthor}
          showActions={showImageActions}
        />
      )}

      {/* Text content - render caption text; poll/event tokens render as empty spans inline */}
      {text && parts.some(p => (p.type === "text" || p.type === "link" || p.type === "markdown-link" || p.type === "mention") && p.content && p.content.trim()) && (
        <div
          className="min-w-0 max-w-full whitespace-pre-wrap"
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {parts.length === 0 ? (
            // Fallback: render text as-is if parsing fails
            text
          ) : (
            parts.map((part, index) => {
              if (part.type === "markdown-link") {
                // Markdown link: show linkText, href to content (URL)
                return (
                  <a
                    key={index}
                    href={part.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-full align-top break-words underline hover:opacity-80"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    onClick={(e) => { e.preventDefault(); handleLinkClick(e); safeOpenUrl(part.content); }}
                  >
                    {part.linkText}
                  </a>
                );
               }
              if (part.type === "event-link") {
                // Event links are rendered as empty spans inline; the card is shown below
                return <span key={index} />;
              }
              if (part.type === "poll-link") {
                // Poll tokens render as empty spans; the card is shown below
                return <span key={index} />;
              }
              if (part.type === "link") {
                const videoId = extractYouTubeId(part.content);
                if (videoId) {
                  return <span key={index} />;
                }
                return (
                  <a
                    key={index}
                    href={ensureProtocol(part.content)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-full align-top break-all underline hover:opacity-80"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    onClick={(e) => { e.preventDefault(); handleLinkClick(e); safeOpenUrl(ensureProtocol(part.content)); }}
                  >
                    {truncateUrl(part.content)}
                  </a>
                );
              }
              if (part.type === "mention" && part.content) {
                return (
                  <span
                    key={index}
                    className="font-semibold"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {part.content}
                  </span>
                );
              }
              if (part.type === "text" && part.content) {
                return (
                  <span
                    key={index}
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {searchQuery ? highlightText(part.content, searchQuery) : part.content}
                  </span>
                );
              }
              // Safety fallback for any part with content
              return part.content ? (
                <span
                  key={index}
                  style={{
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {part.content}
                </span>
              ) : null;
            })
          )}
        </div>
      )}

      {/* Event link cards - only if showPreviews (otherwise rendered outside bubble via previewsOnly) */}
      {showPreviews && eventIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {eventIds.map((eventId) => (
            <EventLinkCard key={eventId} eventId={eventId} />
          ))}
        </div>
      )}

      {/* Poll cards - only if showPreviews (otherwise rendered outside bubble via previewsOnly) */}
      {showPreviews && pollIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {pollIds.map((pollId) => (
            <PollCard key={pollId} pollId={pollId} />
          ))}
        </div>
      )}

      {/* YouTube embeds - only if showPreviews */}
      {showPreviews && youtubeUrls.length > 0 && (
        <div className="space-y-2 mt-2 min-w-0 max-w-full">
          {youtubeUrls.map(({ url, videoId }) => (
            <YouTubeEmbed key={url} videoId={videoId} compact />
          ))}
        </div>
      )}

      {/* Link previews for non-YouTube URLs - only if showPreviews */}
      {showPreviews && otherUrls.length > 0 && (
        <div className="space-y-2 mt-2 min-w-0 max-w-full">
          {otherUrls.map((url) => (
            <LinkPreview key={url} url={url} compact />
          ))}
        </div>
      )}
    </div>
  );
});
