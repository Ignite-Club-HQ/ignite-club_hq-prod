import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
/**
 * Mirror of the chip sizing logic inside `ObjectGlyph` so the resolver knows
 * the *actual* rendered footprint of each chip rather than a fixed minimum
 * distance. Returns the chip's pixel width / height as drawn in the DOM.
 */
export function chipPixelSize(p: RenderableObject): { w: number; h: number } {
  const label = (p.label ?? "P").trim();
  const isWaiting = typeof p.id === "string" && /^w\d+$/i.test(p.id);
  const baseHeight = isWaiting ? 32 : 44;
  const isShort = label.length <= 2;
  const fontSize = isShort
    ? (isWaiting ? 13 : 15)
    : label.length <= 4
      ? (isWaiting ? 11 : 13)
      : label.length <= 7
        ? (isWaiting ? 10 : 12)
        : (isWaiting ? 9 : 11);
  const horizontalPadding = isShort ? 0 : (label.length <= 4 ? 8 : 10);
  // Approximate text width — bold sans-serif glyphs average ~0.6× font size.
  // We don't need pixel-perfect accuracy here, just a tight upper bound that
  // tracks the real chip width as labels grow.
  const textWidth = label.length * fontSize * 0.6;
  const contentWidth = textWidth + horizontalPadding * 2;
  // The chip is `min-width: baseHeight` (circular when short), expanding into
  // a pill once the text demands more room.
  const w = Math.max(baseHeight, contentWidth);
  return { w, h: baseHeight };
}

/**
 * Resolve overlapping player chips by gently nudging colliding pairs apart.
 * Operates in pitch-percentage space (0–100). Only the player chips are
 * adjusted — the underlying drill coordinates are never mutated, so editing
 * and persistence remain authored-correct.
 *
 * `containerSize` provides the live pitch dimensions in pixels so we can
 * convert each chip's actual rendered width/height into accurate % units.
 * Without it we fall back to a sensible 400×600 default — close enough that
 * the resolver still works during the first paint before measurement lands.
 */
export function resolvePlayerOverlaps(
  objects: RenderableObject[],
  containerSize: { w: number; h: number } | null,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  // Only player chips need separation — other objects (cones, goals, ball)
  // either render at different z-orders or have intentionally different sizes.
  const players = objects.filter((o) => o.type === "player");
  if (players.length < 2) {
    for (const p of players) positions.set(p.id, { x: p.x, y: p.y });
    return positions;
  }

  const cw = containerSize?.w && containerSize.w > 0 ? containerSize.w : 400;
  const ch = containerSize?.h && containerSize.h > 0 ? containerSize.h : 600;

  // Convert each chip's real rendered pixel size into pitch-% half-extents.
  // Half-extent + a tiny breathing-room pad = the minimum centre-to-centre
  // distance required on each axis to avoid any visual overlap.
  const halfFor = (p: RenderableObject) => {
    const { w, h } = chipPixelSize(p);
    return {
      rx: (w / 2 / cw) * 100,
      ry: (h / 2 / ch) * 100,
    };
  };
  const halves = new Map(players.map((p) => [p.id, halfFor(p)]));

  // Padding gap (in pitch-%) — a small visual breathing space between chips.
  // 4px on a typical 400px-wide pitch ≈ 1% — keeps chips from kissing.
  const padX = (4 / cw) * 100;
  const padY = (4 / ch) * 100;

  const work = players.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  // A few relaxation passes are enough for typical drill densities.
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i];
        const b = work[j];
        const ha = halves.get(a.id)!;
        const hb = halves.get(b.id)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        // Required spacing on each axis = sum of half-widths/heights + gap.
        const reqX = ha.rx + hb.rx + padX;
        const reqY = ha.ry + hb.ry + padY;
        // Normalise into a single distance metric: a chip is "colliding" when
        // it sits inside the bounding ellipse defined by reqX/reqY.
        const ndx = dx / reqX;
        const ndy = dy / reqY;
        const ndist = Math.hypot(ndx, ndy);
        if (ndist > 1) continue; // No overlap — skip.
        // Push apart along the connecting axis until the ellipse condition holds.
        const overlap = 1 - ndist;
        // Avoid div-by-zero when chips share exact coordinates: pick a default
        // axis based on row/column orientation (horizontal nudge for rows).
        const nx = ndist > 0.0001 ? ndx / ndist : 1;
        const ny = ndist > 0.0001 ? ndy / ndist : 0;
        // Convert the normalised push back to % units, scaled by required dist.
        const shiftX = nx * overlap * reqX * 0.55;
        const shiftY = ny * overlap * reqY * 0.55;
        a.x = clamp(a.x - shiftX);
        a.y = clamp(a.y - shiftY);
        b.x = clamp(b.x + shiftX);
        b.y = clamp(b.y + shiftY);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const p of work) positions.set(p.id, { x: p.x, y: p.y });
  return positions;
}

/**
 * Push balls away from any player chips so the ball never sits underneath
 * (or visually overlaps) a player. Uses the resolved player positions so
 * we account for the nudges applied above.
 */
function resolveBallOverlaps(
  objects: RenderableObject[],
  playerPositions: Map<string, { x: number; y: number }>,
  containerSize: { w: number; h: number } | null,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const balls = objects.filter((o) => o.type === "ball");
  if (balls.length === 0) return positions;

  const cw = containerSize?.w && containerSize.w > 0 ? containerSize.w : 400;
  const ch = containerSize?.h && containerSize.h > 0 ? containerSize.h : 600;

  // Pre-compute player footprints from their actual rendered chip sizes,
  // converted into pitch-% half-extents using the live container dimensions.
  const players = objects.filter((o) => o.type === "player");
  const playerHalves = players.map((p) => {
    const { w, h } = chipPixelSize(p);
    const pos = playerPositions.get(p.id) ?? { x: p.x, y: p.y };
    return {
      x: pos.x,
      y: pos.y,
      rx: (w / 2 / cw) * 100,
      ry: (h / 2 / ch) * 100,
    };
  });

  // Ball glyph is ~30px tall/wide → derive its half-extent from the actual
  // pitch size so it scales with the surface.
  const ballRx = (15 / cw) * 100;
  const ballRy = (15 / ch) * 100;
  const padX = (4 / cw) * 100;
  const padY = (4 / ch) * 100;

  for (const ball of balls) {
    let bx = ball.x;
    let by = ball.y;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (const ph of playerHalves) {
        const dx = bx - ph.x;
        const dy = by - ph.y;
        const reqX = ph.rx + ballRx + padX;
        const reqY = ph.ry + ballRy + padY;
        const ndx = dx / reqX;
        const ndy = dy / reqY;
        const ndist = Math.hypot(ndx, ndy);
        if (ndist >= 1) continue;
        const overlap = 1 - ndist;
        // If ball sits exactly on the player, push it down-right by default.
        const nx = ndist > 0.0001 ? ndx / ndist : 0.7071;
        const ny = ndist > 0.0001 ? ndy / ndist : 0.7071;
        bx = clamp(bx + nx * overlap * reqX);
        by = clamp(by + ny * overlap * reqY);
        moved = true;
      }
      if (!moved) break;
    }
    positions.set(ball.id, { x: bx, y: by });
  }
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

  // Track the live pitch container size so the resolver can convert each
  // chip's actual pixel footprint into accurate pitch-% half-extents. Falls
  // back to a sensible default until the first measurement lands.
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Pre-compute non-overlapping display positions for player chips.
  const displayPositions = useMemo(
    () => resolvePlayerOverlaps(objects, containerSize),
    [objects, containerSize],
  );
  // Then push balls away from any player they would otherwise sit under.
  const ballPositions = useMemo(
    () => resolveBallOverlaps(objects, displayPositions, containerSize),
    [objects, displayPositions, containerSize],
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
        const pos =
          obj.type === "ball"
            ? ballPositions.get(obj.id) ?? { x: obj.x, y: obj.y }
            : displayPositions.get(obj.id) ?? { x: obj.x, y: obj.y };
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
