import { useState, useEffect, useRef } from "react";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Flag, ShieldAlert, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { downloadImage } from "@/lib/downloadImage";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { Capacitor } from "@capacitor/core";
import { applyStatusBarForViewer, refreshStatusBar } from "@/lib/statusBarControl";
import { isVideoUrl } from "@/lib/videoUtils";
import {
  TAP_MAX_HOLD_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_DIST,
  TAP_SLOP,
  MULTI_FINGER_SUPPRESS_MS,
} from "./fullscreenImageViewerConfig";

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
  } = usePinchZoom(1, 4);
  const [isAnimating, setIsAnimating] = useState(false);
  // Snap-back animation params, recomputed per double-tap based on pan distance.
  const [snapAnim, setSnapAnim] = useState({ duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // Timestamp (ms) until which any synthesized React onDoubleClick should be
  // ignored because a 3+ finger system gesture just ended. Browsers can fire
  // a synthetic dblclick after multi-touch — this poisons that path.
  const multiFingerSuppressUntilRef = useRef<number>(0);

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

  // Stable ref to triggerZoomToggle so the touch-listener effect below can
  // call the latest version WITHOUT having to re-run (and thus tear down +
  // re-attach the non-passive touch listeners) every time scale/translate
  // changes. On iOS, removing a touchmove listener mid-gesture causes the
  // WebView to fall back to its native pinch handler, which silently
  // hijacks the gesture — that's why pinch worked on Android but not iOS.
  const triggerZoomToggleRef = useRef(triggerZoomToggle);
  triggerZoomToggleRef.current = triggerZoomToggle;

  // Attach native non-passive touch listeners so preventDefault() actually
  // works on iOS (React's synthetic touch listeners are passive).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // Gesture-arbitration thresholds live in fullscreenImageViewerConfig.ts
    // so tests and future per-device tuning share a single source of truth.

    // Per-gesture arbitration flags. Reset on touchstart of the first finger
    // and whenever a second finger lands. Ensures only one gesture (pinch,
    // drag, long-press, OR double-tap) "wins" any given touch sequence.
    let gestureHadMultiTouch = false;
    // 3+ finger gestures (system gestures: iOS app switcher swipe, Android
    // split-screen, accessibility, screenshots) must NEVER trigger zoom.
    // Once tripped, this flag suppresses double-tap arbitration AND the
    // React synthetic onDoubleClick handler until the next clean single-tap
    // sequence begins.
    let gestureHadMultiFinger = false;
    let gestureMoved = false;
    let gestureStartX = 0;
    let gestureStartY = 0;
    let gestureStartTime = 0;

    const handleStart = (e: globalThis.TouchEvent) => {
      // Stop propagation so the viewer's gesture sequence is fully isolated
      // from any chat / swipe-to-reply / long-press handlers on ancestors.
      // Combined with the React portal below this guarantees iOS pinch never
      // races against a parent's onPointerDown(preventDefault).
      e.stopPropagation();
      // Track the peak finger count for this whole gesture sequence — a
      // 3-finger swipe that briefly drops to 1 finger as the user lifts
      // must still be treated as a system gesture, not a tap candidate.
      if (e.touches.length >= 3) {
        gestureHadMultiFinger = true;
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
        // Bail before forwarding to pinch-zoom — 3+ fingers is never a pinch.
        return;
      }
      if (e.touches.length === 1) {
        // Fresh single-finger sequence — start tracking for tap/drag/long-press.
        gestureHadMultiTouch = false;
        gestureHadMultiFinger = false;
        gestureMoved = false;
        gestureStartX = e.touches[0].clientX;
        gestureStartY = e.touches[0].clientY;
        gestureStartTime = Date.now();
      } else if (e.touches.length === 2) {
        // Pinch started — kill any pending tap candidate so the pinch can't
        // accidentally trigger a double-tap when fingers lift.
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
      }
      pinchTouchStart(e as unknown as React.TouchEvent);
    };
    const handleMove = (e: globalThis.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length >= 3) {
        // Promoted to a system multi-finger gesture mid-sequence.
        gestureHadMultiFinger = true;
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
        return;
      }
      if (e.touches.length === 2) {
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
      } else if (e.touches.length === 1 && !gestureMoved) {
        const dx = e.touches[0].clientX - gestureStartX;
        const dy = e.touches[0].clientY - gestureStartY;
        if (Math.hypot(dx, dy) > TAP_SLOP) {
          gestureMoved = true;
        }
      }
      pinchTouchMove(e as unknown as React.TouchEvent);
    };
    const handleEnd = (e: globalThis.TouchEvent) => {
      // Stop propagation so chat-message swipe-to-reply / long-press handlers
      // on ancestor DOM nodes (the viewer is rendered as a portal but legacy
      // call sites may still nest it) can't intercept the gesture finalisation.
      e.stopPropagation();
      pinchTouchEnd(e);
      const heldMs = Date.now() - gestureStartTime;
      const wasLongPress = heldMs >= TAP_MAX_HOLD_MS;
      // Detect double-tap on touchend, but only if the gesture was a true
      // single-finger short tap (no pinch, no 3+ finger system gesture, no
      // drag, no long-press). This prevents double-tap from firing during
      // pinch-zoom, at the tail of a pan, after a long press, or after the
      // user lifts a 3-finger system gesture.
      if (
        e.changedTouches.length === 1 &&
        e.touches.length === 0 &&
        !gestureHadMultiTouch &&
        !gestureHadMultiFinger &&
        !gestureMoved &&
        !wasLongPress
      ) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        if (
          last &&
          now - last.time < DOUBLE_TAP_MS &&
          Math.hypot(t.clientX - last.x, t.clientY - last.y) < DOUBLE_TAP_DIST
        ) {
          e.preventDefault();
          triggerZoomToggleRef.current();
          lastTapRef.current = null;
          return;
        }
        lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 0) {
        // Sequence ended as a pinch, drag, long-press, or 3+ finger system
        // gesture — invalidate any tap candidate so the next genuine tap
        // can't pair with this one. Also expose the multi-finger flag to
        // the React onDoubleClick handler via the ref below.
        lastTapRef.current = null;
        if (gestureHadMultiFinger) {
          // Briefly poison the React synthetic double-click path too —
          // some browsers synthesize dblclick after multi-touch ends.
          multiFingerSuppressUntilRef.current = Date.now() + MULTI_FINGER_SUPPRESS_MS;
        }
      }
    };
    const handleCancel = (e: globalThis.TouchEvent) => {
      e.stopPropagation();
      pinchTouchEnd(e);
      lastTapRef.current = null;
      gestureHadMultiTouch = false;
      gestureHadMultiFinger = false;
      gestureMoved = false;
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
    // IMPORTANT: only re-attach when the pinch hook's stable callbacks change.
    // triggerZoomToggle is intentionally NOT in deps — it's invoked via a ref
    // above so this effect doesn't re-run on every scale/translate update,
    // which would tear down the touch listeners mid-gesture and break iOS
    // pinch-zoom (Android is more tolerant of this churn).
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
    // Suppress React's synthetic double-click if a 3+ finger system gesture
    // just ended — those are never meant to zoom the image.
    if (Date.now() < multiFingerSuppressUntilRef.current) return;
    triggerZoomToggle();
  }, [triggerZoomToggle]);

  // Use max(safe-area, 1.75rem) so action icons always clear the Android
  // status bar even inside in-app browsers (Messenger, etc.) where
  // env(safe-area-inset-top) reports 0.
  const safeTop = "max(env(safe-area-inset-top), 1.75rem)";

  // Render via a portal to document.body so the viewer escapes the chat
  // message subtree. Inside the chat tree, ancestor handlers (swipe-to-reply,
  // long-press timers, onPointerDown(preventDefault) on message bubbles)
  // intercept touch events on iOS WebView and starve the pinch gesture.
  // Portalling guarantees the viewer's touch sequence is owned exclusively
  // by its own listeners.
  const content = (
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
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/70 to-transparent"
        style={{ paddingTop: `calc(${safeTop} + 0.5rem)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: back/close */}
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Right: overflow menu */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
              aria-label="More options"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="z-[1000002] min-w-[180px]">
            <DropdownMenuItem onSelect={() => { void downloadImage(effectiveSrc, "ignite-photo"); }}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </DropdownMenuItem>
            {showActions && onReport && (
              <DropdownMenuItem onSelect={() => { setTimeout(() => onReport(), 0); }}>
                <Flag className="h-4 w-4 mr-2" />
                Report
              </DropdownMenuItem>
            )}
            {showActions && onBlockUser && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => { setTimeout(() => onBlockUser(), 0); }}
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  <ShieldAlert className="h-4 w-4 mr-2" />
                  Block user
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
