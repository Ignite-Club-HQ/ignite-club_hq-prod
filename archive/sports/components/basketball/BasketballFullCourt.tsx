import { memo } from "react";

interface BasketballFullCourtProps {
  className?: string;
}

/**
 * SVG basketball full-court (optional view).
 * 100x100 square viewBox. Both hoops drawn (top + bottom).
 * Lower density of detail than the half-court so player tokens stay readable.
 */
const BasketballFullCourt = memo(function BasketballFullCourt({
  className,
}: BasketballFullCourtProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="100" fill="hsl(28 55% 45%)" />
      <rect x="0" y="0" width="100" height="100" fill="hsl(28 60% 30% / 0.15)" />

      {/* Outer boundary */}
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.5" />

      {/* Centre line + circle */}
      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.5" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="white" strokeWidth="0.5" />

      {/* TOP half (hoop at y≈6) */}
      <rect x="36" y="2" width="28" height="22" fill="hsl(28 70% 55%)" stroke="white" strokeWidth="0.4" />
      <line x1="42" y1="6" x2="58" y2="6" stroke="white" strokeWidth="0.9" />
      <circle cx="50" cy="8" r="1.2" fill="none" stroke="white" strokeWidth="0.6" />
      <line x1="10" y1="2" x2="10" y2="14" stroke="white" strokeWidth="0.4" />
      <line x1="90" y1="2" x2="90" y2="14" stroke="white" strokeWidth="0.4" />
      <path d="M 10 14 A 28 28 0 0 0 90 14" fill="none" stroke="white" strokeWidth="0.4" />

      {/* BOTTOM half (hoop at y≈94) */}
      <rect x="36" y="76" width="28" height="22" fill="hsl(28 70% 55%)" stroke="white" strokeWidth="0.4" />
      <line x1="42" y1="94" x2="58" y2="94" stroke="white" strokeWidth="0.9" />
      <circle cx="50" cy="92" r="1.2" fill="none" stroke="white" strokeWidth="0.6" />
      <line x1="10" y1="86" x2="10" y2="98" stroke="white" strokeWidth="0.4" />
      <line x1="90" y1="86" x2="90" y2="98" stroke="white" strokeWidth="0.4" />
      <path d="M 10 86 A 28 28 0 0 1 90 86" fill="none" stroke="white" strokeWidth="0.4" />

      <text x="4" y="98" fontSize="2.5" fill="white" opacity="0.4" fontFamily="sans-serif">
        FULL COURT
      </text>
    </svg>
  );
});

export default BasketballFullCourt;
