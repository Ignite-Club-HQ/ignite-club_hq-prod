import { memo, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  Annotation,
  ArrowGeometry,
  DrillObject,
  StepMarkerGeometry,
  TextGeometry,
  ZoneGeometry,
} from "./types";

type ItemKind = "object" | "annotation";

/**
 * Both raw and interpolated objects/annotations carry an optional `opacity` field
 * (added by the playback engine for fade-in/out). We accept either type here.
 */
type RenderableObject = DrillObject & { opacity?: number };
type RenderableAnnotation = Annotation & { opacity?: number };

interface TrainingObjectLayerProps {
  objects: RenderableObject[];
  annotations: RenderableAnnotation[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onObjectMove?: (id: string, x: number, y: number) => void;
  onAnnotationMove?: (id: string, x: number, y: number) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  /** When true (e.g. presentation/playback) all interactions are disabled */
  readOnly?: boolean;
}

function rectFromContainer(
  ref: React.RefObject<HTMLDivElement>,
  clientX: number,
  clientY: number
) {
  const rect = ref.current?.getBoundingClientRect();
  if (!rect) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}

/**
 * Resolve overlapping player chips by gently nudging colliding pairs apart.
 * Operates in pitch-percentage space (0–100). Only the player chips are
 * adjusted — the underlying drill coordinates are never mutated, so editing
 * and persistence remain authored-correct.
 */
function resolvePlayerOverlaps(
  objects: RenderableObject[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  // Only player chips need separation — other objects (cones, goals, ball)
  // either render at different z-orders or have intentionally different sizes.
  const players = objects.filter((o) => o.type === "player");
  if (players.length < 2) {
    for (const p of players) positions.set(p.id, { x: p.x, y: p.y });
    return positions;
  }
  // Approximate chip footprint in % of pitch. Active chips ~44px on a typical
  // 360–500px wide pitch ≈ 9–12% wide. We use a conservative 8% min spacing.
  const minDist = 8;
  const work = players.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  // A few relaxation passes are enough for typical drill densities.
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i];
        const b = work[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        // Collision — push the two chips apart along the connecting axis.
        const overlap = minDist - dist;
        // Avoid div-by-zero when chips share exact coordinates.
        const nx = dist > 0.0001 ? dx / dist : 1;
        const ny = dist > 0.0001 ? dy / dist : 0;
        const shift = overlap / 2 + 0.05;
        a.x = clamp(a.x - nx * shift);
        a.y = clamp(a.y - ny * shift);
        b.x = clamp(b.x + nx * shift);
        b.y = clamp(b.y + ny * shift);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const p of work) positions.set(p.id, { x: p.x, y: p.y });
  return positions;
}

function ObjectGlyph({ obj }: { obj: DrillObject }) {
  switch (obj.type) {
    case "player": {
      const label = (obj.label || "P").trim();
      // Waiting / bench players (seeded with ids w1..wN) read as muted so the
      // active players on the pitch immediately stand out.
      const isWaiting = typeof obj.id === "string" && /^w\d+$/i.test(obj.id);
      const baseHeight = isWaiting ? 32 : 44; // active +15-20% over previous baseline
      // Always render the full name INSIDE the chip — never as a separate
      // floating pill. Short labels stay circular; longer names expand the
      // chip into a horizontal pill so the whole name fits cleanly.
      const isShort = label.length <= 2;
      const fontSize = isShort
        ? (isWaiting ? 13 : 15)
        : label.length <= 4
          ? (isWaiting ? 11 : 13)
          : label.length <= 7
            ? (isWaiting ? 10 : 12)
            : (isWaiting ? 9 : 11);
      const horizontalPadding = isShort ? 0 : (label.length <= 4 ? 8 : 10);
      return (
        <div className="select-none">
          <div
            className={cn(
              "flex items-center justify-center text-white font-bold whitespace-nowrap",
              isShort ? "rounded-full" : "rounded-full",
              isWaiting ? "border-2" : "border-[3px]",
            )}
            style={{
              height: baseHeight,
              minWidth: baseHeight,
              paddingLeft: horizontalPadding,
              paddingRight: horizontalPadding,
              backgroundColor: obj.color,
              borderColor: "#ffffff",
              boxShadow: isWaiting
                ? "0 1px 3px rgba(0,0,0,0.35)"
                : "0 3px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.3)",
              fontSize,
              lineHeight: 1,
              opacity: isWaiting ? 0.85 : 1,
              textShadow: "0 1px 1px rgba(0,0,0,0.5)",
            }}
          >
            {label}
          </div>
        </div>
      );
    }
    case "ball":
      return (
        <span
          role="img"
          aria-label="ball"
          className="select-none leading-none"
          style={{
            fontSize: 30,
            lineHeight: 1,
            filter: "drop-shadow(1px 2px 4px rgba(0,0,0,0.65))",
          }}
        >
          ⚽
        </span>
      );
    case "cone":
      return (
        <div
          className="select-none"
          style={{
            width: 0,
            height: 0,
            borderLeft: "9px solid transparent",
            borderRight: "9px solid transparent",
            borderBottom: `18px solid ${obj.color}`,
            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))",
          }}
        />
      );
    case "mini-goal":
      return (
        <div
          className="border-2 rounded-sm shadow"
          style={{ width: 36, height: 10, borderColor: obj.color, backgroundColor: "transparent" }}
        />
      );
    case "full-goal":
      return (
        <div
          className="border-2 rounded-sm shadow"
          style={{ width: 64, height: 14, borderColor: obj.color, backgroundColor: "transparent" }}
        />
      );
  }
}

function AnnotationGlyph({ ann }: { ann: Annotation }) {
  switch (ann.type) {
    case "arrow-solid":
    case "arrow-dashed": {
      return (
        <div
          className="rounded-full border border-white/60"
          style={{
            width: 10,
            height: 10,
            backgroundColor: ann.style?.color ?? "#fbbf24",
          }}
        />
      );
    }
    case "zone": {
      const g = ann.geometry as ZoneGeometry;
      return (
        <div
          className="border-2 rounded-md"
          style={{
            width: `${g.width}%`,
            height: `${g.height}%`,
            backgroundColor: ann.style?.color ?? "#22c55e",
            opacity: ann.style?.opacity ?? 0.25,
            borderColor: ann.style?.color ?? "#22c55e",
          }}
        />
      );
    }
    case "text": {
      const g = ann.geometry as TextGeometry;
      return (
        <div
          className="px-2 py-0.5 rounded bg-black/60 text-white text-xs font-medium whitespace-nowrap select-none"
          style={{ color: ann.style?.color }}
        >
          {g.text}
        </div>
      );
    }
    case "step-marker": {
      const g = ann.geometry as StepMarkerGeometry;
      return (
        <div
          className="rounded-full flex items-center justify-center text-xs font-bold text-white shadow border-2 border-white"
          style={{
            width: 26,
            height: 26,
            backgroundColor: ann.style?.color ?? "#ef4444",
          }}
        >
          {g.number}
        </div>
      );
    }
  }
}

function TrainingObjectLayerImpl({
  objects,
  annotations,
  selectedId,
  onSelect,
  onObjectMove,
  onAnnotationMove,
  containerRef,
  readOnly,
}: TrainingObjectLayerProps) {
  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      id: string,
      kind: ItemKind,
      anchorX: number,
      anchorY: number
    ) => {
      if (readOnly) return;
      e.stopPropagation();
      onSelect?.(id);
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const startCoord = rectFromContainer(containerRef, e.clientX, e.clientY);
      if (!startCoord) return;
      const offsetX = startCoord.x - anchorX;
      const offsetY = startCoord.y - anchorY;

      const onMove = (ev: PointerEvent) => {
        const c = rectFromContainer(containerRef, ev.clientX, ev.clientY);
        if (!c) return;
        const nx = clamp(c.x - offsetX);
        const ny = clamp(c.y - offsetY);
        if (kind === "object") onObjectMove?.(id, nx, ny);
        else onAnnotationMove?.(id, nx, ny);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [containerRef, onAnnotationMove, onObjectMove, onSelect, readOnly]
  );

  const arrows = annotations.filter(
    (a) => a.type === "arrow-solid" || a.type === "arrow-dashed"
  );

  // Pre-compute non-overlapping display positions for player chips.
  const displayPositions = useMemo(
    () => resolvePlayerOverlaps(objects),
    [objects],
  );

  return (
    <>
      {/* Arrow lines */}
      {arrows.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 30 }}
        >
          <defs>
            <marker
              id="training-arrowhead"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 6 3, 0 6" fill="#fbbf24" />
            </marker>
            <marker
              id="training-arrowhead-dashed"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 6 3, 0 6" fill="#a78bfa" />
            </marker>
          </defs>
          {arrows.map((ann) => {
            const g = ann.geometry as ArrowGeometry;
            const isDashed = ann.type === "arrow-dashed";
            return (
              <line
                key={ann.id}
                x1={`${g.from.x}%`}
                y1={`${g.from.y}%`}
                x2={`${g.to.x}%`}
                y2={`${g.to.y}%`}
                stroke={ann.style?.color ?? (isDashed ? "#a78bfa" : "#fbbf24")}
                strokeWidth={2}
                strokeDasharray={isDashed ? "6 4" : undefined}
                markerEnd={`url(#${isDashed ? "training-arrowhead-dashed" : "training-arrowhead"})`}
                opacity={(ann.opacity ?? 1) * (selectedId === ann.id ? 1 : 0.95)}
              />
            );
          })}
        </svg>
      )}

      {/* Zones */}
      {annotations
        .filter((a) => a.type === "zone")
        .map((ann) => {
          const g = ann.geometry as ZoneGeometry;
          const isSel = selectedId === ann.id;
          return (
            <div
              key={ann.id}
              onPointerDown={(e) => handlePointerDown(e, ann.id, "annotation", g.x, g.y)}
              className={cn(
                "absolute touch-none",
                !readOnly && "cursor-grab active:cursor-grabbing",
                isSel && "ring-2 ring-primary ring-offset-1 ring-offset-pitch-green rounded-md"
              )}
              style={{
                left: `${g.x}%`,
                top: `${g.y}%`,
                zIndex: 20,
                opacity: ann.opacity ?? 1,
              }}
            >
              <AnnotationGlyph ann={ann} />
            </div>
          );
        })}

      {/* Text + step markers + arrow handles. Hide the seeded "wait-label"
          text — it's replaced by the dedicated <NextUpZone /> visual so the
          floating "Waiting line — rotate in" caption no longer competes with
          the pitch. */}
      {annotations
        .filter((a) => a.type !== "zone" && a.id !== "wait-label")
        .map((ann) => {
          let ax = 0;
          let ay = 0;
          if (ann.type === "arrow-solid" || ann.type === "arrow-dashed") {
            const g = ann.geometry as ArrowGeometry;
            ax = g.from.x;
            ay = g.from.y;
          } else if (ann.type === "text") {
            const g = ann.geometry as TextGeometry;
            ax = g.x;
            ay = g.y;
          } else if (ann.type === "step-marker") {
            const g = ann.geometry as StepMarkerGeometry;
            ax = g.x;
            ay = g.y;
          }
          const isSel = selectedId === ann.id;
          return (
            <div
              key={ann.id}
              onPointerDown={(e) => handlePointerDown(e, ann.id, "annotation", ax, ay)}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 touch-none",
                !readOnly && "cursor-grab active:cursor-grabbing",
                isSel && "ring-2 ring-primary ring-offset-1 ring-offset-pitch-green rounded-full"
              )}
              style={{
                left: `${ax}%`,
                top: `${ay}%`,
                zIndex: 35,
                opacity: ann.opacity ?? 1,
              }}
            >
              <AnnotationGlyph ann={ann} />
            </div>
          );
        })}

      {/* Objects — players render above the ball so a chip is never obscured.
          Player chips are nudged apart so they never visually overlap, while
          their underlying drill coordinates stay untouched (drag/edit logic
          still uses the authored x/y). */}
      {/* Objects — players render above the ball so a chip is never obscured.
          Player chips are nudged apart so they never visually overlap, while
          their underlying drill coordinates stay untouched (drag/edit logic
          still uses the authored x/y). */}
      {objects.map((obj) => {
        const isSel = selectedId === obj.id;
        const z = obj.type === "ball" ? 38 : 45;
        const pos = displayPositions.get(obj.id) ?? { x: obj.x, y: obj.y };
        return (
          <div
            key={obj.id}
            onPointerDown={(e) => handlePointerDown(e, obj.id, "object", obj.x, obj.y)}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 touch-none",
              !readOnly && "cursor-grab active:cursor-grabbing",
              isSel && "ring-2 ring-primary ring-offset-2 ring-offset-pitch-green rounded-full"
            )}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              zIndex: z,
              opacity: obj.opacity ?? 1,
              transition: "left 120ms ease-out, top 120ms ease-out",
            }}
          >
            <ObjectGlyph obj={obj} />
          </div>
        );
      })}
    </>
  );
}

export const TrainingObjectLayer = memo(TrainingObjectLayerImpl);
