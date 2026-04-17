import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { detectGameBoardKind, GameBoardKind } from "@/lib/sportDetection";

/**
 * GameBoard dispatcher.
 *
 * Renders the correct sport-specific board based on the club's sport:
 *  - "soccer" / "football" / "futsal" → existing PitchBoard (unchanged)
 *  - "netball"                       → NetballBoard
 *  - "basketball"                    → BasketballBoard
 *
 * The soccer pitch board is intentionally untouched; this component
 * simply chooses which sibling to lazy-load.
 */

const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));
const NetballBoard = lazy(() => import("@/components/netball/NetballBoard"));
const BasketballBoard = lazy(() => import("@/components/basketball/BasketballBoard"));

interface GameBoardProps {
  /** Club sport string from `clubs.sport`. If unknown, falls back to soccer. */
  sport: string | null | undefined;
  teamId: string;
  teamName: string;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
  onClose: () => void;
  /** Soccer-only props are forwarded as-is; others ignore them. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  soccerProps?: Record<string, any>;
  /** Netball-only props. */
  netballProps?: {
    initialMinutesPerQuarter?: number;
    readOnly?: boolean;
  };
  /** Basketball-only props. */
  basketballProps?: {
    initialMinutesPerQuarter?: number;
    readOnly?: boolean;
  };
}

const Loading = () => (
  <div className="flex-1 flex items-center justify-center min-h-[300px] bg-card">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export default function GameBoard({
  sport,
  teamId,
  teamName,
  members,
  onClose,
  soccerProps = {},
  netballProps = {},
  basketballProps = {},
}: GameBoardProps) {
  const kind: GameBoardKind = detectGameBoardKind(sport);

  return (
    <Suspense fallback={<Loading />}>
      {kind === "basketball" ? (
        <BasketballBoard
          teamId={teamId}
          teamName={teamName}
          members={members}
          onClose={onClose}
          {...basketballProps}
        />
      ) : kind === "netball" ? (
        <NetballBoard
          teamId={teamId}
          teamName={teamName}
          members={members}
          onClose={onClose}
          {...netballProps}
        />
      ) : (
        <PitchBoard
          teamId={teamId}
          teamName={teamName}
          members={members}
          onClose={onClose}
          {...soccerProps}
        />
      )}
    </Suspense>
  );
}
