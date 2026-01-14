import { useState, useEffect, useCallback, useRef } from "react";

// Types for Fabric.js classes we use
type FabricCanvas = import("fabric").Canvas;
type FabricPencilBrush = import("fabric").PencilBrush;
type FabricLine = typeof import("fabric").Line;
type FabricTriangle = typeof import("fabric").Triangle;
type FabricGroup = typeof import("fabric").Group;

interface FabricModule {
  Canvas: typeof import("fabric").Canvas;
  PencilBrush: typeof import("fabric").PencilBrush;
  Line: FabricLine;
  Triangle: FabricTriangle;
  Group: FabricGroup;
}

// Cached promise for the Fabric module
let fabricModulePromise: Promise<FabricModule> | null = null;
let fabricModuleCache: FabricModule | null = null;

// Load Fabric.js module (returns cached if already loaded)
const loadFabricModule = (): Promise<FabricModule> => {
  if (fabricModuleCache) {
    return Promise.resolve(fabricModuleCache);
  }
  
  if (!fabricModulePromise) {
    fabricModulePromise = import("fabric").then((module) => {
      fabricModuleCache = {
        Canvas: module.Canvas,
        PencilBrush: module.PencilBrush,
        Line: module.Line,
        Triangle: module.Triangle,
        Group: module.Group,
      };
      return fabricModuleCache;
    });
  }
  
  return fabricModulePromise;
};

// Prefetch Fabric.js in the background (call after initial UI render)
export const prefetchFabric = (): void => {
  // Use requestIdleCallback if available for optimal timing
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(() => {
      loadFabricModule();
    });
  } else {
    // Fallback: load after a short delay
    setTimeout(() => {
      loadFabricModule();
    }, 300);
  }
};

interface UseLazyFabricOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  enabled: boolean; // Only initialize when true (e.g., drawing mode)
  initialColor?: string;
  onCanvasReady?: (canvas: FabricCanvas) => void;
  dependencies?: any[]; // Additional deps to trigger reinit (e.g., isLandscape)
}

interface UseLazyFabricReturn {
  canvas: FabricCanvas | null;
  isLoading: boolean;
  isReady: boolean;
  fabricModule: FabricModule | null;
  clearCanvas: () => void;
  disposeCanvas: () => void;
}

export function useLazyFabric({
  canvasRef,
  containerRef,
  enabled,
  initialColor = "#ffffff",
  onCanvasReady,
  dependencies = [],
}: UseLazyFabricOptions): UseLazyFabricReturn {
  const [canvas, setCanvas] = useState<FabricCanvas | null>(null);
  const [fabricModule, setFabricModule] = useState<FabricModule | null>(fabricModuleCache);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const initializingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Load Fabric module when enabled
  useEffect(() => {
    if (!enabled || fabricModule) return;
    
    setIsLoading(true);
    loadFabricModule()
      .then((module) => {
        setFabricModule(module);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load Fabric.js:", err);
        setIsLoading(false);
      });
  }, [enabled, fabricModule]);

  // Initialize canvas when module is loaded and enabled
  useEffect(() => {
    if (!enabled || !fabricModule || !canvasRef.current || !containerRef.current) {
      return;
    }

    // Prevent double initialization
    if (initializingRef.current) return;
    initializingRef.current = true;

    // Clean up previous canvas
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Small delay to let container settle (especially after orientation change)
    const timeoutId = setTimeout(() => {
      if (!canvasRef.current || !containerRef.current) {
        initializingRef.current = false;
        return;
      }

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      // Skip if dimensions are invalid
      if (rect.width < 10 || rect.height < 10) {
        initializingRef.current = false;
        return;
      }

      console.log("[LazyFabric] Initializing canvas:", rect.width, "x", rect.height);

      const { Canvas, PencilBrush } = fabricModule;

      const newCanvas = new Canvas(canvasRef.current, {
        width: rect.width,
        height: rect.height,
        backgroundColor: "transparent",
        selection: false,
        allowTouchScrolling: false,
      });

      newCanvas.freeDrawingBrush = new PencilBrush(newCanvas);
      newCanvas.freeDrawingBrush.color = initialColor;
      newCanvas.freeDrawingBrush.width = 3;

      // Style wrapper and canvas elements for touch
      const wrapperEl = newCanvas.wrapperEl;
      const upperCanvas = newCanvas.upperCanvasEl;
      const lowerCanvas = newCanvas.lowerCanvasEl;

      [wrapperEl, upperCanvas, lowerCanvas].forEach((el) => {
        if (el) {
          el.style.touchAction = "none";
        }
      });

      if (wrapperEl) {
        wrapperEl.style.position = "absolute";
        wrapperEl.style.inset = "0";
        wrapperEl.style.width = "100%";
        wrapperEl.style.height = "100%";
      }

      // Prevent scroll during drawing
      const preventScroll = (e: TouchEvent) => {
        e.preventDefault();
      };

      upperCanvas.addEventListener("touchstart", preventScroll, { passive: false });
      upperCanvas.addEventListener("touchmove", preventScroll, { passive: false });

      // Store cleanup function
      cleanupRef.current = () => {
        upperCanvas.removeEventListener("touchstart", preventScroll);
        upperCanvas.removeEventListener("touchmove", preventScroll);
        newCanvas.dispose();
      };

      setCanvas(newCanvas);
      setIsReady(true);
      initializingRef.current = false;

      if (onCanvasReady) {
        onCanvasReady(newCanvas);
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      initializingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fabricModule, ...dependencies]);

  // Cleanup on unmount or when disabled
  useEffect(() => {
    if (!enabled && cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
      setCanvas(null);
      setIsReady(false);
    }
  }, [enabled]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const clearCanvas = useCallback(() => {
    if (canvas) {
      canvas.clear();
      canvas.backgroundColor = "transparent";
      canvas.renderAll();
    }
  }, [canvas]);

  const disposeCanvas = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setCanvas(null);
    setIsReady(false);
  }, []);

  return {
    canvas,
    isLoading,
    isReady,
    fabricModule,
    clearCanvas,
    disposeCanvas,
  };
}

export default useLazyFabric;
