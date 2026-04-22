import { useState, useEffect, useRef } from "react";
import { useCallback } from "react";
import { X, Download, Flag, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { Capacitor } from "@capacitor/core";
import { applyStatusBarForViewer, refreshStatusBar } from "@/lib/statusBarControl";
import { isVideoUrl } from "@/lib/videoUtils";

interface FullscreenImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
  onReport?: () => void;
  onBlockUser?: () => void;
  showActions?: boolean;
}

export function FullscreenImageViewer({ src, alt = "Image", onClose, onReport, onBlockUser, showActions = false }: FullscreenImageViewerProps) {
  const [loaded, setLoaded] = useState(false);
  const { signedUrl } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;
  const {
    scale,
    translateX,
    translateY,
    onTouchStart: pinchTouchStart,
    onTouchMove: pinchTouchMove,
    onTouchEnd: pinchTouchEnd,
    resetZoom,
    onDoubleClick: pinchDoubleClick,
    isPanningOrPinching,
  } = usePinchZoom(1, 4);
  const [isAnimating, setIsAnimating] = useState(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lock body scroll to prevent iOS viewport shift
  useIOSScrollLock(true);

  // Attach native non-passive touch listeners so preventDefault() actually
  // works on iOS (React's synthetic touch listeners are passive).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleStart = (e: globalThis.TouchEvent) => {
      pinchTouchStart(e as unknown as React.TouchEvent);
    };
    const handleMove = (e: globalThis.TouchEvent) => {
      pinchTouchMove(e as unknown as React.TouchEvent);
    };
    const handleEnd = () => pinchTouchEnd();
    node.addEventListener("touchstart", handleStart, { passive: false });
    node.addEventListener("touchmove", handleMove, { passive: false });
    node.addEventListener("touchend", handleEnd, { passive: false });
    node.addEventListener("touchcancel", handleEnd, { passive: false });
    return () => {
      node.removeEventListener("touchstart", handleStart);
      node.removeEventListener("touchmove", handleMove);
      node.removeEventListener("touchend", handleEnd);
      node.removeEventListener("touchcancel", handleEnd);
    };
  }, [pinchTouchStart, pinchTouchMove, pinchTouchEnd]);

  // Force status bar to light icons on black background, restore on unmount
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    applyStatusBarForViewer();
    return () => {
      refreshStatusBar();
    };
  }, []);

  useEffect(() => {
    setLoaded(false);
    resetZoom();
  }, [effectiveSrc, resetZoom]);

  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      resetZoom();
    }
  }, [scale, resetZoom]);

  // Use max(safe-area, 1.75rem) so action icons always clear the Android
  // status bar even inside in-app browsers (Messenger, etc.) where
  // env(safe-area-inset-top) reports 0.
  const safeTop = "max(env(safe-area-inset-top), 1.75rem)";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center overscroll-none"
      style={{
        paddingTop: safeTop,
        paddingBottom: 'env(safe-area-inset-bottom)',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onClick={scale === 1 ? onClose : undefined}
      onDoubleClick={handleDoubleClick}
    >
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-4 text-white hover:bg-white/20 z-10"
        style={{ top: `calc(${safeTop} + 0.5rem)` }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-6 w-6" />
      </Button>

      <div
        className="absolute left-4 flex gap-2 z-10"
        style={{ top: `calc(${safeTop} + 0.5rem)` }}
      >
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-white/20"
          onClick={(e) => { e.stopPropagation(); safeOpenUrl(effectiveSrc); }}
        >
          <Download className="h-6 w-6" />
        </Button>
        {showActions && onReport && (
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); onReport(); }}
            title="Report image"
          >
            <Flag className="h-5 w-5" />
          </Button>
        )}
        {showActions && onBlockUser && (
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); onBlockUser(); }}
            title="Block user"
          >
            <ShieldAlert className="h-5 w-5" />
          </Button>
        )}
      </div>

      {!loaded && (
        <div className="animate-pulse bg-muted/20 rounded w-64 h-64" />
      )}
      {isVideoUrl(effectiveSrc) ? (
        <video
          src={effectiveSrc}
          className={`max-w-[95vw] max-h-[90vh] object-contain rounded transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
          onLoadedData={() => setLoaded(true)}
        />
      ) : (
        <img
          src={effectiveSrc}
          alt={alt}
          className={`max-w-[95vw] max-h-[90vh] object-contain rounded transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
          style={{
            transform: `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`,
            touchAction: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
      )}
    </div>
  );
}
