import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Annotation, DrillFrame, DrillObject, TrainingTool } from "./types";
import { TrainingObjectLayer } from "./TrainingObjectLayer";
import {
  cloneAnnotation,
  cloneObject,
  createAnnotation,
  createEmptyFrame,
  createObject,
} from "./objectFactories";
import { TrainingToolbar } from "./TrainingToolbar";

interface TrainingBoardProps {
  /** Optional: focus the toolbar in landscape (board fills full screen) */
  isLandscape?: boolean;
  readOnly?: boolean;
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}

/**
 * Pitch SVG markings — reused styling from existing match pitch but standalone
 * so we don't import or alter PitchBoard internals.
 */
function PitchMarkings() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* outer */}
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      {/* halfway line */}
      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      {/* centre circle */}
      <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="0.7" fill="white" fillOpacity="0.7" />
      {/* top penalty area */}
      <rect x="22" y="2" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="2" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      {/* bottom penalty area */}
      <rect x="22" y="84" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="92" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
    </svg>
  );
}

/**
 * TrainingBoard — Phase 1 MVP.
 * Single in-memory frame, full toolbar, free positioning, multi-ball, overlapping zones.
 * Does NOT touch active_games, the timer, or any match logic.
 */
export default function TrainingBoard({ isLandscape, readOnly }: TrainingBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DrillFrame>(() => createEmptyFrame(0));
  const [activeTool, setActiveTool] = useState<TrainingTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepCounter, setStepCounter] = useState(1);
  const [playerCounter, setPlayerCounter] = useState(1);

  const hasSelection = !!selectedId;

  // ---- Object / annotation mutators ----
  const addObject = useCallback(
    (obj: DrillObject) => {
      setFrame((f) => ({ ...f, objects: [...f.objects, obj] }));
      setSelectedId(obj.id);
    },
    []
  );

  const addAnnotation = useCallback((ann: Annotation) => {
    setFrame((f) => ({ ...f, annotations: [...f.annotations, ann] }));
    setSelectedId(ann.id);
  }, []);

  const moveObject = useCallback((id: string, x: number, y: number) => {
    setFrame((f) => ({
      ...f,
      objects: f.objects.map((o) => (o.id === id ? { ...o, x: clamp(x), y: clamp(y) } : o)),
    }));
  }, []);

  const moveAnnotation = useCallback((id: string, x: number, y: number) => {
    setFrame((f) => ({
      ...f,
      annotations: f.annotations.map((a) => {
        if (a.id !== id) return a;
        const cx = clamp(x);
        const cy = clamp(y);
        switch (a.type) {
          case "arrow-solid":
          case "arrow-dashed": {
            // Translate both endpoints by delta from "from" anchor
            const g = a.geometry as { from: { x: number; y: number }; to: { x: number; y: number } };
            const dx = cx - g.from.x;
            const dy = cy - g.from.y;
            return {
              ...a,
              geometry: {
                from: { x: cx, y: cy },
                to: { x: clamp(g.to.x + dx), y: clamp(g.to.y + dy) },
              },
            };
          }
          case "zone":
            return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
          case "text":
            return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
          case "step-marker":
            return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
        }
      }),
    }));
  }, []);

  // ---- Pitch tap handler — places the active tool ----
  const handlePitchPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      // Only act if clicking the pitch surface itself (not a child object)
      if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute("data-pitch-surface")) {
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      if (activeTool === "select") {
        setSelectedId(null);
        return;
      }

      // Object tools
      if (
        activeTool === "player" ||
        activeTool === "ball" ||
        activeTool === "cone" ||
        activeTool === "mini-goal" ||
        activeTool === "full-goal"
      ) {
        const overrides: Partial<DrillObject> =
          activeTool === "player" ? { label: String(playerCounter) } : {};
        if (activeTool === "player") setPlayerCounter((n) => n + 1);
        addObject(createObject(activeTool, x, y, overrides));
        return;
      }

      // Annotation tools
      if (activeTool === "step-marker") {
        addAnnotation(createAnnotation("step-marker", x, y, { stepNumber: stepCounter }));
        setStepCounter((n) => n + 1);
        return;
      }
      if (activeTool === "text") {
        const text = window.prompt("Label text:", "Note");
        if (!text) return;
        addAnnotation(createAnnotation("text", x, y, { text }));
        return;
      }
      addAnnotation(createAnnotation(activeTool, x, y));
    },
    [activeTool, addAnnotation, addObject, playerCounter, readOnly, stepCounter]
  );

  // ---- Toolbar actions ----
  const handleDuplicate = useCallback(() => {
    if (!selectedId) return;
    setFrame((f) => {
      const obj = f.objects.find((o) => o.id === selectedId);
      if (obj) {
        const next = cloneObject(obj);
        return { ...f, objects: [...f.objects, next] };
      }
      const ann = f.annotations.find((a) => a.id === selectedId);
      if (ann) {
        const next = cloneAnnotation(ann);
        return { ...f, annotations: [...f.annotations, next] };
      }
      return f;
    });
  }, [selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    setFrame((f) => ({
      ...f,
      objects: f.objects.filter((o) => o.id !== selectedId),
      annotations: f.annotations.filter((a) => a.id !== selectedId),
    }));
    setSelectedId(null);
  }, [selectedId]);

  const handleClear = useCallback(() => {
    if (frame.objects.length === 0 && frame.annotations.length === 0) return;
    if (!window.confirm("Clear the entire board? This cannot be undone.")) return;
    setFrame((f) => ({ ...f, objects: [], annotations: [] }));
    setSelectedId(null);
    setStepCounter(1);
    setPlayerCounter(1);
  }, [frame.annotations.length, frame.objects.length]);

  const cursorClass = useMemo(() => {
    if (activeTool === "select") return "cursor-default";
    return "cursor-crosshair";
  }, [activeTool]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-pitch-green">
      {/* Pitch surface */}
      <div className="flex-1 min-h-0 p-2 flex items-center justify-center">
        <div
          ref={containerRef}
          data-pitch-surface
          onPointerDown={handlePitchPointerDown}
          className={cn(
            "relative rounded-lg overflow-hidden shadow-lg select-none",
            cursorClass,
            isLandscape ? "w-full h-full" : "w-full max-w-[700px] aspect-[2/3]"
          )}
          style={{
            backgroundColor: "hsl(var(--pitch-green))",
            // subtle horizontal stripes for grass feel
            backgroundImage:
              "repeating-linear-gradient(0deg, hsla(0,0%,100%,0.03) 0 8%, transparent 8% 16%)",
          }}
        >
          <PitchMarkings />
          <TrainingObjectLayer
            objects={frame.objects}
            annotations={frame.annotations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onObjectMove={moveObject}
            onAnnotationMove={moveAnnotation}
            containerRef={containerRef}
            readOnly={readOnly}
          />
          {/* Empty-state hint */}
          {frame.objects.length === 0 && frame.annotations.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="px-3 py-1.5 rounded-md bg-black/40 text-white/90 text-xs font-medium">
                Pick a tool below, then tap the pitch to add it
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <TrainingToolbar
          activeTool={activeTool}
          onToolChange={(t) => {
            setActiveTool(t);
            if (t !== "select") setSelectedId(null);
          }}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onClear={handleClear}
          hasSelection={hasSelection}
        />
      )}
    </div>
  );
}
