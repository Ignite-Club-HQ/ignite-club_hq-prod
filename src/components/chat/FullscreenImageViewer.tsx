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
  // Snap-back animation params, recomputed per double-tap based on pan distance.
  const [snapAnim, setSnapAnim] = useState({ duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lock body scroll to prevent iOS viewport shift
  useIOSScrollLock(true);

  // Trigger smooth animated zoom toggle on double-tap.
  // When the image is panned/zoomed, this performs a snap-back animation that
  // smoothly returns the image to 1× centered. Duration scales with how far
  // the image was panned so short snaps feel snappy and large snaps feel
  // weighted; the ease-out-back curve gives a subtle "settle" at the end.
  const triggerZoomToggle = useCallback(() => {
    const isPannedOrZoomed = scale > 1 || translateX !== 0 || translateY !== 0;
    if (isPannedOrZoomed) {
      // Distance from center, used to scale the snap-back duration.
      const dist = Math.hypot(translateX, translateY);
      // 220ms baseline up to 360ms for a long fling-back.
      const duration = Math.min(360, 220 + dist * 0.3);
      // Soft ease-out-back: smooth deceleration with a tiny overshoot then settle.
      setSnapAnim({ duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      setIsAnimating(true);
      resetZoom();
      window.setTimeout(() => setIsAnimating(false), duration + 20);
    } else {
      // Zoom-in toggle (1× → 2.2×) keeps the snappier baseline curve.
      setSnapAnim({ duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      setIsAnimating(true);
      pinchDoubleClick({} as React.MouseEvent);
      window.setTimeout(() => setIsAnimating(false), 240);
    }
  }, [pinchDoubleClick, resetZoom, scale, translateX, translateY]);

  // Attach native non-passive touch listeners so preventDefault() actually
  // works on iOS (React's synthetic touch listeners are passive).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const DOUBLE_TAP_MS = 300;
    const DOUBLE_TAP_DIST = 32;

    const handleStart = (e: globalThis.TouchEvent) => {
      pinchTouchStart(e as unknown as React.TouchEvent);
    };
    const handleMove = (e: globalThis.TouchEvent) => {
      pinchTouchMove(e as unknown as React.TouchEvent);
    };
    const handleEnd = (e: globalThis.TouchEvent) => {
      pinchTouchEnd();
      // Detect double-tap on touchend (single-finger only).
      if (e.changedTouches.length === 1 && e.touches.length === 0) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        if (
          last &&
          now - last.time < DOUBLE_TAP_MS &&
          Math.hypot(t.clientX - last.x, t.clientY - last.y) < DOUBLE_TAP_DIST
        ) {
          e.preventDefault();
          triggerZoomToggle();
          lastTapRef.current = null;
          return;
        }
        lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };
      }
    };
    const handleCancel = () => {
      pinchTouchEnd();
    };
    node.addEventListener("touchstart", handleStart, { passive: false });
    node.addEventListener("touchmove", handleMove, { passive: false });
    node.addEventListener("touchend", handleEnd, { passive: false });
    node.addEventListener("touchcancel", handleCancel, { passive: false });
    return () => {
      node.removeEventListener("touchstart", handleStart);
      node.removeEventListener("touchmove", handleMove);
      node.removeEventListener("touchend", handleEnd);
      node.removeEventListener("touchcancel", handleCancel);
    };
  }, [pinchTouchStart, pinchTouchMove, pinchTouchEnd, triggerZoomToggle]);

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
    triggerZoomToggle();
  }, [triggerZoomToggle]);

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
            transition: isAnimating ? `transform ${snapAnim.duration}ms ${snapAnim.easing}` : "none",
            touchAction: 'none',
            willChange: 'transform',
          }}
          onClick={(e) => e.stopPropagation()}
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
      )}
    </div>
  );
}
