import { memo, useMemo } from "react";
import type { Annotation, DrillObject } from "./types";

interface NextUpZoneProps {
  objects: DrillObject[];
  annotations: Annotation[];
}

/**
 * Some seeded drills (see migration 20260422103800) ship with a row of
 * "waiting" players (ids `w1`, `w2`...) plus a free-floating text annotation
 * labelled "Waiting line — rotate in". The floating label is unclear; this
 * component replaces it with a soft, dashed "Next Up" zone drawn behind the
 * waiting players so the bench area reads as a defined region of the pitch.
 *
 * Returns null when no waiting players are present so static drills are
 * unaffected.
 */
function NextUpZoneImpl({ objects, annotations: _annotations }: NextUpZoneProps) {
  const waiting = useMemo(
    () =>
      objects.filter(
        (o) =>
          o.type === "player" &&
          typeof o.id === "string" &&
          /^w\d+$/i.test(o.id),
      ),
    [objects],
  );

  if (waiting.length === 0) return null;

  // Compute a tight bounding box around the waiting players in 0-100 coords,
  // then pad it so the zone breathes around the tokens.
  const xs = waiting.map((o) => (o as { x: number }).x);
  const ys = waiting.map((o) => (o as { y: number }).y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Always treat the waiting area as a horizontal bench along the bottom-most
  // edge of the waiting chips (per the "waiting section is always at bottom"
  // rule). We pad more vertically than horizontally so the zone clearly reads
  // as a bench strip rather than a free-floating box.
  const PADDING_X = 6;
  const PADDING_Y = 8;
  const left = Math.max(0, minX - PADDING_X);
  const right = Math.min(100, maxX + PADDING_X);
  const top = Math.max(0, minY - PADDING_Y);
  const bottom = Math.min(100, maxY + PADDING_Y);

  // Place the "Next Up" pill above the zone whenever the zone is in the
  // bottom half (typical), otherwise below — never off-pitch.
  const labelOnTop = minY > 50;
  const labelOnLeft = minX > 50;

  return (
    <div
      aria-hidden
      className="absolute pointer-events-none"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${right - left}%`,
        height: `${bottom - top}%`,
        zIndex: 10,
      }}
    >
      <div
        className="w-full h-full rounded-lg"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.22)",
          border: "1.5px dashed rgba(255, 255, 255, 0.45)",
        }}
      />
      <span
        className="absolute px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide text-white shadow"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.65)",
          letterSpacing: "0.06em",
          ...(labelOnTop ? { top: -10 } : { bottom: -10 }),
          ...(labelOnLeft ? { right: 6 } : { left: 6 }),
        }}
      >
        Next Up
      </span>
    </div>
  );
}

export const NextUpZone = memo(NextUpZoneImpl);
export default NextUpZone;
