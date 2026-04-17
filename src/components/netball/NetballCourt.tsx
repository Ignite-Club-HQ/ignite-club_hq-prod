import { memo } from "react";

/**
 * SVG netball court rendered as a background.
 * Uses semantic tokens via CSS-vars where possible; specific court colors
 * live here because they're domain-specific (white lines on green/blue).
 *
 * Coordinate space is 100x200 (portrait) so child positions can use
 * percentages directly.
 */
interface NetballCourtProps {
  className?: string;
}

const NetballCourt = memo(function NetballCourt({ className }: NetballCourtProps) {
  return (
    <svg
      viewBox="0 0 100 200"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {/* Court surface */}
      <rect x="0" y="0" width="100" height="200" fill="hsl(var(--pitch-green, 142 60% 25%))" />

      {/* Outer boundary */}
      <rect
        x="2"
        y="2"
        width="96"
        height="196"
        fill="none"
        stroke="white"
        strokeWidth="0.6"
      />

      {/* Third lines (horizontal) */}
      <line x1="2" y1="68" x2="98" y2="68" stroke="white" strokeWidth="0.5" />
      <line x1="2" y1="132" x2="98" y2="132" stroke="white" strokeWidth="0.5" />

      {/* Centre circle */}
      <circle cx="50" cy="100" r="6" fill="none" stroke="white" strokeWidth="0.5" />

      {/* Top shooting circle (semi) */}
      <path
        d="M 30 2 A 22 22 0 0 0 70 2"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
      />
      {/* Top goal box */}
      <rect x="40" y="2" width="20" height="3" fill="none" stroke="white" strokeWidth="0.5" />
      <circle cx="50" cy="2" r="1" fill="white" />

      {/* Bottom shooting circle (semi) */}
      <path
        d="M 30 198 A 22 22 0 0 1 70 198"
        fill="none"
        stroke="white"
        strokeWidth="0.5"
      />
      {/* Bottom goal box */}
      <rect x="40" y="195" width="20" height="3" fill="none" stroke="white" strokeWidth="0.5" />
      <circle cx="50" cy="198" r="1" fill="white" />

      {/* Third labels */}
      <text x="4" y="36" fontSize="3" fill="white" opacity="0.4" fontFamily="sans-serif">
        ATTACK
      </text>
      <text x="4" y="100" fontSize="3" fill="white" opacity="0.4" fontFamily="sans-serif">
        CENTRE
      </text>
      <text x="4" y="166" fontSize="3" fill="white" opacity="0.4" fontFamily="sans-serif">
        DEFENCE
      </text>
    </svg>
  );
});

export default NetballCourt;
