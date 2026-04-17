import { useState, useRef, useCallback, useEffect } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { isVideoUrl } from "@/lib/videoUtils";

interface MediaPlayerProps {
  src: string;
  alt?: string;
  className?: string;
  /** When true, render fully expanded (lightbox/fullscreen mode) */
  fullscreen?: boolean;
  /** Click handler — typically opens lightbox */
  onClick?: (e: React.MouseEvent) => void;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Renders an image OR a video, deciding by URL extension.
 * Video shows a centered play overlay and uses native controls when tapped.
 */
export function MediaPlayer({
  src,
  alt = "Media",
  className,
  fullscreen = false,
  onClick,
  onLoad,
  onError,
}: MediaPlayerProps) {
  const isVideo = isVideoUrl(src);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
  }, [src]);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      if (fullscreen) {
        // In fullscreen, tap toggles play/pause
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          void v.play();
          setIsPlaying(true);
        } else {
          v.pause();
          setIsPlaying(false);
        }
        return;
      }
      // Inline preview: delegate to onClick (open lightbox)
      onClick?.(e);
    },
    [fullscreen, onClick],
  );

  if (isVideo) {
    return (
      <div
        className={cn("relative inline-block", className)}
        onClick={handleVideoClick}
      >
        <video
          ref={videoRef}
          src={src}
          className={cn(
            "w-full h-auto",
            fullscreen ? "max-w-[95vw] max-h-[90vh] object-contain" : "max-h-64 object-cover cursor-pointer",
          )}
          preload="metadata"
          playsInline
          controls={fullscreen}
          muted={!fullscreen}
          onLoadedData={() => onLoad?.()}
          onError={() => onError?.()}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        {!fullscreen && !isPlaying && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="rounded-full bg-black/60 p-3">
              <Play className="h-6 w-6 fill-white text-white" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn(
        fullscreen ? "max-w-[95vw] max-h-[90vh] object-contain" : "w-full h-auto max-h-64 object-cover cursor-pointer",
        className,
      )}
      onClick={onClick}
      onLoad={() => onLoad?.()}
      onError={() => onError?.()}
      draggable={false}
    />
  );
}
