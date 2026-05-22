import { useCallback, useState } from "react";

/**
 * Pinch-zoom + zoom controls for PitchBoard.
 *
 * Owns `zoom` (1..3) and the in-flight `lastPinchDistance` ref-as-state for
 * two-finger pinch on the pitch surface. Player drag continues to live in
 * PitchBoard (step 6b) — this hook only handles the pinch branch.
 *
 * iOS gesture-handler rule: every helper here is synchronous and never awaits,
 * so it can be called directly inside React touch handlers without breaking
 * the user-gesture context (no Camera/getUserMedia involvement, but we follow
 * the same discipline for consistency with the wider codebase).
 *
 * Returns:
 * - zoom / setZoom / handleZoomIn / handleZoomOut / handleResetZoom
 * - handleWheel: ctrl/cmd + wheel desktop zoom
 * - tryPinchStart(e): records pinch baseline when 2 fingers land. Returns
 *   `true` when the event was a 2-finger start (caller may early-return).
 * - tryPinchMove(e): consumes 2-finger moves and adjusts zoom. Returns `true`
 *   when handled — caller MUST early-return so player-drag logic is skipped.
 * - tryPinchEnd(e): clears pinch baseline once fewer than 2 fingers remain.
 *   Always safe to call; never returns a value the caller has to branch on.
 */
export function usePitchBoardPinchZoom() {
  const [zoom, setZoom] = useState(1);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  const getPinchDist = (touches: React.TouchList | TouchList) => {
    const t0 = touches[0];
    const t1 = touches[1];
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getPinchDistance = useCallback((touches: React.TouchList): number | null => {
    if (touches.length < 2) return null;
    return getPinchDist(touches);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(prev + delta, 1), 3));
    }
  }, []);

  const tryPinchStart = useCallback((e: React.TouchEvent): boolean => {
    if (e.touches.length === 2) {
      const dist = getPinchDistance(e.touches);
      if (dist !== null) {
        setLastPinchDistance(dist);
      }
      return true;
    }
    return false;
  }, [getPinchDistance]);

  const tryPinchMove = useCallback((e: React.TouchEvent): boolean => {
    if (e.touches.length === 2 && lastPinchDistance !== null) {
      e.preventDefault();
      const dist = getPinchDistance(e.touches);
      if (dist !== null) {
        const delta = (dist - lastPinchDistance) * 0.005;
        setZoom(prev => Math.min(Math.max(prev + delta, 1), 3));
        setLastPinchDistance(dist);
      }
      return true;
    }
    return false;
  }, [lastPinchDistance, getPinchDistance]);

  const tryPinchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setLastPinchDistance(null);
    }
  }, []);

  return {
    zoom,
    setZoom,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleWheel,
    tryPinchStart,
    tryPinchMove,
    tryPinchEnd,
  };
}
