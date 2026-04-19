import { useRef, useState, useCallback, TouchEvent, WheelEvent, MouseEvent } from "react";

interface PinchZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface UsePinchZoomReturn {
  scale: number;
  translateX: number;
  translateY: number;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onWheel: (e: WheelEvent) => void;
  onMouseDown: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onDoubleClick: (e: MouseEvent) => void;
  resetZoom: () => void;
  isPanningOrPinching: () => boolean;
}

export function usePinchZoom(minScale = 1, maxScale = 4): UsePinchZoomReturn {
  const [state, setState] = useState<PinchZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const initialCenter = useRef<{ x: number; y: number } | null>(null);
  const lastTranslate = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);

  // Single-finger pan state
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const isPanning = useRef(false);

  // Mouse drag-to-pan state (desktop)
  const mousePanStart = useRef<{ x: number; y: number } | null>(null);
  const isMousePanning = useRef(false);

  const getDistance = (touch1: React.Touch, touch2: React.Touch): number => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCenter = (touch1: React.Touch, touch2: React.Touch): { x: number; y: number } => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      isPanning.current = false;
      panStart.current = null;
      initialDistance.current = getDistance(e.touches[0], e.touches[1]);
      initialScale.current = stateRef.current.scale;
      initialCenter.current = getCenter(e.touches[0], e.touches[1]);
      lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
      e.preventDefault();
    } else if (e.touches.length === 1 && stateRef.current.scale > 1) {
      // Start single-finger pan when zoomed
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
      isPanning.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current && isPinching.current) {
      e.preventDefault();
      
      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const currentCenter = getCenter(e.touches[0], e.touches[1]);
      
      const scaleRatio = currentDistance / initialDistance.current;
      let newScale = initialScale.current * scaleRatio;
      newScale = Math.min(Math.max(newScale, minScale), maxScale);
      
      let newTranslateX = lastTranslate.current.x;
      let newTranslateY = lastTranslate.current.y;
      
      if (initialCenter.current) {
        const centerDeltaX = currentCenter.x - initialCenter.current.x;
        const centerDeltaY = currentCenter.y - initialCenter.current.y;
        newTranslateX = lastTranslate.current.x + centerDeltaX;
        newTranslateY = lastTranslate.current.y + centerDeltaY;
      }
      
      if (newScale <= 1) {
        newTranslateX = 0;
        newTranslateY = 0;
      }
      
      setState({
        scale: newScale,
        translateX: newTranslateX,
        translateY: newTranslateY,
      });
    } else if (e.touches.length === 1 && isPanning.current && panStart.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      setState({
        scale: stateRef.current.scale,
        translateX: lastTranslate.current.x + dx,
        translateY: lastTranslate.current.y + dy,
      });
    }
  }, [minScale, maxScale]);

  const onTouchEnd = useCallback(() => {
    initialDistance.current = null;
    initialCenter.current = null;
    isPinching.current = false;
    panStart.current = null;
    isPanning.current = false;
    
    if (stateRef.current.scale < 1.15) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    }
  }, []);

  // Mouse wheel zoom (desktop). Hold no modifier — wheel = zoom in/out.
  const onWheel = useCallback((e: WheelEvent) => {
    // Only intercept zoom-style wheel events (ctrl/cmd held = pinch trackpad).
    // For coaches on desktop, plain wheel = zoom feels natural inside the court.
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    const current = stateRef.current.scale;
    let next = current * (1 + delta);
    next = Math.min(Math.max(next, minScale), maxScale);
    if (next === current) return;
    if (next <= 1.001) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    } else {
      setState({
        scale: next,
        translateX: stateRef.current.translateX,
        translateY: stateRef.current.translateY,
      });
    }
  }, [minScale, maxScale]);

  // Mouse drag to pan when zoomed (desktop).
  const onMouseDown = useCallback((e: MouseEvent) => {
    if (stateRef.current.scale <= 1) return;
    if (e.button !== 0) return;
    mousePanStart.current = { x: e.clientX, y: e.clientY };
    lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
    isMousePanning.current = true;
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isMousePanning.current || !mousePanStart.current) return;
    const dx = e.clientX - mousePanStart.current.x;
    const dy = e.clientY - mousePanStart.current.y;
    setState({
      scale: stateRef.current.scale,
      translateX: lastTranslate.current.x + dx,
      translateY: lastTranslate.current.y + dy,
    });
  }, []);

  const onMouseUp = useCallback(() => {
    mousePanStart.current = null;
    isMousePanning.current = false;
  }, []);

  // Double-click toggles between 1× and 2.2× — fast desktop "zoom in here".
  const onDoubleClick = useCallback((_e: MouseEvent) => {
    if (stateRef.current.scale > 1) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    } else {
      setState({ scale: 2.2, translateX: 0, translateY: 0 });
    }
  }, []);

  const resetZoom = useCallback(() => {
    setState({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const isPanningOrPinching = useCallback(() => {
    return (
      isPinching.current ||
      isPanning.current ||
      isMousePanning.current ||
      stateRef.current.scale > 1
    );
  }, []);

  return {
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick,
    resetZoom,
    isPanningOrPinching,
  };
}
