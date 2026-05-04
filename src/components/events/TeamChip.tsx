import { Badge } from "@/components/ui/badge";
import { detectTeamColor } from "@/lib/teamColor";

interface TeamChipProps {
  teamName?: string | null;
  /** Used when there is no team (e.g. club-wide events). */
  fallbackLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function isLightHex(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.85;
}

/**
 * Team identity chip used across all event cards. The team is the primary
 * scanning anchor — it should be the most prominent text on the card.
 */
export function TeamChip({ teamName, fallbackLabel = "Club event", size = "md", className = "" }: TeamChipProps) {
  const label = teamName || fallbackLabel;
  const teamColor = teamName ? detectTeamColor(teamName) : null;
  const lightColor = teamColor ? isLightHex(teamColor.hex) : false;

  const sizeClass =
    size === "lg"
      ? "text-sm h-7 px-3 gap-2"
      : size === "sm"
        ? "text-[11px] h-5 px-2 gap-1.5"
        : "text-[12px] h-6 px-2.5 gap-1.5";

  const chipStyle = teamColor && !lightColor
    ? {
        backgroundColor: `${teamColor.hex}26`,
        color: teamColor.hex,
        borderColor: `${teamColor.hex}66`,
      }
    : undefined;

  const baseClass = teamColor
    ? lightColor
      ? "font-bold bg-muted text-foreground border border-border max-w-full truncate inline-flex items-center"
      : "font-bold border max-w-full truncate inline-flex items-center"
    : "font-bold bg-primary/10 text-primary border border-primary/20 max-w-full truncate inline-flex items-center";

  return (
    <Badge
      variant="secondary"
      style={chipStyle}
      className={`${baseClass} ${sizeClass} ${className}`}
    >
      {teamColor && (
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: teamColor.hex, boxShadow: `0 0 0 1px ${teamColor.hex}99` }}
        />
      )}
      <span className="truncate">{label}</span>
    </Badge>
  );
}
