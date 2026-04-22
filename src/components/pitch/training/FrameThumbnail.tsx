import { memo } from "react";
import type {
  Annotation,
  ArrowGeometry,
  DrillFrame,
  StepMarkerGeometry,
  TextGeometry,
  ZoneGeometry,
} from "./types";

interface FrameThumbnailProps {
  frame: DrillFrame;
  className?: string;
}

/**
 * Lightweight inline-SVG snapshot of a frame.
 * Fast (no html2canvas), themable, scales crisply at any size.
 */
function FrameThumbnailImpl({ frame, className }: FrameThumbnailProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      {/* Pitch background */}
      <rect x="0" y="0" width="100" height="100" fill="hsl(var(--pitch-green))" />
      {/* Markings (subset) */}
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        fill="none"
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="0.5"
      />
      <line
        x1="2"
        y1="50"
        x2="98"
        y2="50"
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="0.5"
      />
      <circle
        cx="50"
        cy="50"
        r="9"
        fill="none"
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="0.5"
      />

      {/* Zones first (background) */}
      {frame.annotations
        .filter((a) => a.type === "zone")
        .map((a) => {
          const g = a.geometry as ZoneGeometry;
          return (
            <rect
              key={a.id}
              x={g.x}
              y={g.y}
              width={g.width}
              height={g.height}
              fill={a.style?.color ?? "#22c55e"}
              fillOpacity={a.style?.opacity ?? 0.25}
              stroke={a.style?.color ?? "#22c55e"}
              strokeWidth={0.4}
              rx={1}
            />
          );
        })}

      {/* Arrows */}
      {frame.annotations
        .filter((a) => a.type === "arrow-solid" || a.type === "arrow-dashed")
        .map((a) => {
          const g = a.geometry as ArrowGeometry;
          const isDashed = a.type === "arrow-dashed";
          return (
            <line
              key={a.id}
              x1={g.from.x}
              y1={g.from.y}
              x2={g.to.x}
              y2={g.to.y}
              stroke={a.style?.color ?? (isDashed ? "#a78bfa" : "#fbbf24")}
              strokeWidth={1}
              strokeDasharray={isDashed ? "2 1.2" : undefined}
              strokeLinecap="round"
            />
          );
        })}

      {/* Step markers */}
      {frame.annotations
        .filter((a) => a.type === "step-marker")
        .map((a) => {
          const g = a.geometry as StepMarkerGeometry;
          return (
            <g key={a.id}>
              <circle
                cx={g.x}
                cy={g.y}
                r={2.4}
                fill={a.style?.color ?? "#ef4444"}
                stroke="white"
                strokeWidth={0.4}
              />
              <text
                x={g.x}
                y={g.y + 0.9}
                fontSize={2.4}
                textAnchor="middle"
                fill="white"
                fontWeight="bold"
              >
                {g.number}
              </text>
            </g>
          );
        })}

      {/* Text labels */}
      {frame.annotations
        .filter((a) => a.type === "text")
        .map((a) => {
          const g = a.geometry as TextGeometry;
          return (
            <text
              key={a.id}
              x={g.x}
              y={g.y}
              fontSize={2.6}
              fill="white"
              textAnchor="middle"
            >
              {g.text.length > 12 ? g.text.slice(0, 12) + "…" : g.text}
            </text>
          );
        })}

      {/* Objects */}
      {frame.objects.map((o) => {
        switch (o.type) {
          case "player":
            return (
              <g key={o.id}>
                <circle
                  cx={o.x}
                  cy={o.y}
                  r={2.6}
                  fill={o.color ?? "#0ea5e9"}
                  stroke="white"
                  strokeWidth={0.5}
                />
                <text
                  x={o.x}
                  y={o.y + 0.9}
                  fontSize={2.4}
                  textAnchor="middle"
                  fill="white"
                  fontWeight="bold"
                >
                  {o.label ?? "P"}
                </text>
              </g>
            );
          case "ball":
            return (
              <circle
                key={o.id}
                cx={o.x}
                cy={o.y}
                r={1.4}
                fill={o.color ?? "#f5f5f5"}
                stroke="black"
                strokeOpacity={0.4}
                strokeWidth={0.2}
              />
            );
          case "cone":
            return (
              <polygon
                key={o.id}
                points={`${o.x - 1.4},${o.y + 1.4} ${o.x + 1.4},${o.y + 1.4} ${o.x},${o.y - 1.4}`}
                fill={o.color ?? "#f97316"}
              />
            );
          case "mini-goal":
            return (
              <rect
                key={o.id}
                x={o.x - 3}
                y={o.y - 0.8}
                width={6}
                height={1.6}
                fill="none"
                stroke={o.color ?? "white"}
                strokeWidth={0.6}
              />
            );
          case "full-goal":
            return (
              <rect
                key={o.id}
                x={o.x - 5}
                y={o.y - 1.2}
                width={10}
                height={2.4}
                fill="none"
                stroke={o.color ?? "white"}
                strokeWidth={0.6}
              />
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

export const FrameThumbnail = memo(FrameThumbnailImpl);
