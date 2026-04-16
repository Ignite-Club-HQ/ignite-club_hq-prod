import { useMemo, memo, useState, useCallback, useRef, useEffect } from "react";
import { LinkPreview } from "./LinkPreview";
import { YouTubeEmbed, extractYouTubeId } from "./YouTubeEmbed";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { EventLinkCard } from "./EventLinkCard";
import { highlightText } from "./ChatSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

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
    
    const result: { type: "text" | "link" | "mention" | "markdown-link"; content: string; userId?: string; linkText?: string }[] = [];
    let lastIndex = 0;
    
    // Combined regex to find markdown links, plain URLs, and mentions
    // Order matters: markdown links first to prevent plain URL matching the URL inside markdown
    const combinedRegex = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|((?:https?:\/\/|www\.)[^\s\]]+)|(@\[([^\]]+)\]\(([^)]+)\))/gi;
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
        // Markdown link match: [text](url) - match[2] is text, match[3] is URL
        result.push({ 
          type: "markdown-link", 
          content: match[3] || "", 
          linkText: match[2] || "" 
        });
      } else if (match[4]) {
        // Plain URL match
        result.push({ type: "link", content: match[4] });
      } else if (match[5]) {
        // Mention match - match[6] is display name, match[7] is userId
        result.push({ 
          type: "mention", 
          content: match[6] || "", 
          userId: match[7] || "" 
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
  const { youtubeUrls, otherUrls } = useMemo(() => {
    const urls = [...new Set(parts.filter(p => p.type === "link").map(p => p.content))];
    const youtube: { url: string; videoId: string }[] = [];
    const other: string[] = [];

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
      {/* Image attachment */}
      {imageUrl && !imageError && (
        <div className="rounded-lg overflow-hidden max-w-xs">
          {(!imageLoaded || isLoadingSignedUrl) && (
            <Skeleton className="w-48 h-32" />
          )}
          {!isLoadingSignedUrl && effectiveImageUrl && (
            <img
              ref={imgRef}
              src={effectiveImageUrl}
              alt="Attachment"
              className={`w-full h-auto max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity ${!imageLoaded ? 'hidden' : ''}`}
              onLoad={handleImageLoad}
              onError={handleImageError}
              onClick={handleImageClick}
            />
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

      {/* Text content */}
      {text && (
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
