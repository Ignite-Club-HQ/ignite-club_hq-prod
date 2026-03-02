import { useRef, useState, useCallback, TouchEvent } from "react";

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
  resetZoom: () => void;
}

export function usePinchZoom(minScale = 1, maxScale = 4): UsePinchZoomReturn {
  const [state, setState] = useState<PinchZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  // Use a ref to always have the latest state for callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const initialCenter = useRef<{ x: number; y: number } | null>(null);
  const lastTranslate = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);

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
      initialDistance.current = getDistance(e.touches[0], e.touches[1]);
      initialScale.current = stateRef.current.scale;
      initialCenter.current = getCenter(e.touches[0], e.touches[1]);
      lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
      e.preventDefault();
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
    }
  }, [minScale, maxScale]);

  const onTouchEnd = useCallback(() => {
    initialDistance.current = null;
    initialCenter.current = null;
    isPinching.current = false;
    
    // Always snap back if close to 1 — read from ref to avoid stale closure
    if (stateRef.current.scale < 1.15) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    }
  }, []);

  const resetZoom = useCallback(() => {
    setState({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  return {
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    resetZoom,
  };
}
