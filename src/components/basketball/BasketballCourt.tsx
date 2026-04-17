import { memo } from "react";

/**
 * SVG basketball half-court (default).
 * Domain-specific colors live here (orange court, white lines).
 *
 * Coordinate space is 100x140 (portrait half-court) so child positions
 * can use percentages directly. The hoop is at the TOP of the layout
 * (y ~ 8) and the half-court line at the bottom (y = 138).
 */
interface BasketballCourtProps {
  className?: string;
}

const BasketballCourt = memo(function BasketballCourt({ className }: BasketballCourtProps) {
  return (
    <svg
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {/* Court surface (warm hardwood tone) */}
      <rect x="0" y="0" width="100" height="140" fill="hsl(28 55% 45%)" />
      {/* Subtle grain overlay */}
      <rect x="0" y="0" width="100" height="140" fill="hsl(28 60% 30% / 0.15)" />

      {/* Outer boundary */}
      <rect
        x="2"
        y="2"
        width="96"
        height="136"
        fill="none"
        stroke="white"
        strokeWidth="0.6"
      />

      {/* Half-court / centre line at bottom edge */}
      <line x1="2" y1="138" x2="98" y2="138" stroke="white" strokeWidth="0.5" />
      {/* Centre semi-circle (top half visible at bottom edge) */}
      <path d="M 38 138 A 12 12 0 0 1 62 138" fill="none" stroke="white" strokeWidth="0.5" />

      {/* The KEY / paint */}
      <rect x="36" y="2" width="28" height="38" fill="hsl(28 70% 55%)" stroke="white" strokeWidth="0.5" />

      {/* Free-throw circle (top half solid, bottom half dashed) */}
      <path d="M 38 40 A 12 12 0 0 0 62 40" fill="none" stroke="white" strokeWidth="0.5" />
      <path
        d="M 38 40 A 12 12 0 0 1 62 40"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />

      {/* Backboard */}
      <line x1="42" y1="6" x2="58" y2="6" stroke="white" strokeWidth="1.2" />

      {/* Hoop */}
      <circle cx="50" cy="9" r="1.6" fill="none" stroke="white" strokeWidth="0.8" />

      {/* Restricted area arc */}
      <path d="M 46 9 A 4 4 0 0 0 54 9" fill="none" stroke="white" strokeWidth="0.5" />

      {/* 3-point arc (corners + arc) */}
      <line x1="10" y1="2" x2="10" y2="20" stroke="white" strokeWidth="0.5" />
      <line x1="90" y1="2" x2="90" y2="20" stroke="white" strokeWidth="0.5" />
      <path
        d="M 10 20 A 42 42 0 0 0 90 20"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
      />

      {/* Subtle zone label */}
      <text x="4" y="135" fontSize="3" fill="white" opacity="0.4" fontFamily="sans-serif">
        HALF COURT
      </text>
    </svg>
  );
});

export default BasketballCourt;
