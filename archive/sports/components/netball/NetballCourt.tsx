import { memo } from "react";

/**
 * Netball court SVG (portrait, full court).
 *
 * Restyled to mirror the basketball board's understated aesthetic:
 * a single muted court colour, soft white lines, no loud zone labels —
 * so player tokens dominate the visual hierarchy.
 *
 * Coordinate space is 100x140 (portrait) to match the basketball aspect
 * ratio so the floating HUD docks consistently across both sports.
 */
interface NetballCourtProps {
  className?: string;
}

const NetballCourt = memo(function NetballCourt({ className }: NetballCourtProps) {
  return (
    <svg
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {/* Court surface — muted blue/teal so tokens dominate. */}
      <rect x="0" y="0" width="100" height="140" fill="hsl(190 32% 38%)" />
      {/* Subtle grain overlay for depth. */}
      <rect x="0" y="0" width="100" height="140" fill="hsl(190 30% 20% / 0.08)" />

      {/* Very low-opacity thirds shading — gives coaches a quick visual cue
          for attack / centre / defence zones without competing with tokens. */}
      <rect x="0" y="0" width="100" height="48" fill="hsl(20 70% 50% / 0.06)" />
      <rect x="0" y="92" width="100" height="48" fill="hsl(250 70% 55% / 0.06)" />

      {/* Outer boundary — soft so it doesn't compete with tokens. */}
      <rect
        x="2"
        y="2"
        width="96"
        height="136"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="0.5"
      />

      {/* Third lines (horizontal) — court split into ATTACK / CENTRE / DEFENCE. */}
      <line x1="2" y1="48" x2="98" y2="48" stroke="white" strokeOpacity="0.5" strokeWidth="0.4" />
      <line x1="2" y1="92" x2="98" y2="92" stroke="white" strokeOpacity="0.5" strokeWidth="0.4" />

      {/* Centre circle */}
      <circle cx="50" cy="70" r="5" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="0.4" />
      <circle cx="50" cy="70" r="0.6" fill="white" fillOpacity="0.6" />

      {/* Top shooting circle (semi) */}
      <path
        d="M 32 2 A 18 18 0 0 0 68 2"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="0.4"
      />
      {/* Top goal post */}
      <circle cx="50" cy="2" r="1" fill="white" fillOpacity="0.8" />

      {/* Bottom shooting circle (semi) */}
      <path
        d="M 32 138 A 18 18 0 0 1 68 138"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="0.4"
      />
      {/* Bottom goal post */}
      <circle cx="50" cy="138" r="1" fill="white" fillOpacity="0.8" />
    </svg>
  );
});

export default NetballCourt;
