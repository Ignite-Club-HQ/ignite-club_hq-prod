import { Button } from "@/components/ui/button";
import {
  ArrowLeftRight,
  Bookmark,
  Calendar,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Settings,
  SkipForward,
  Sparkles,
  Trophy,
  Undo2,
  UserCog,
  UserPlus,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Quarter, RotationMode } from "./types";

interface NetballLiveActionBarProps {
  /** Toggle persistent Sub Mode. */
  onToggleSubMode: () => void;
  /** True when Sub Mode is currently armed. */
  subModeActive?: boolean;
  /** Apply the planned lineup for the next period. */
  onNextBreak: () => void;
  /** Open auto-sub plan panel. */
  onOpenAutoSubs: () => void;
  /** Optional undo handler — disabled when nothing to undo. */
  onUndo?: () => void;
  canUndo?: boolean;
  /** Open the post-game / live game summary dialog. */
  onOpenSummary: () => void;

  // Demoted setup actions (slide into "More" overflow):
  onOpenSquad: () => void;
  onOpenLineups: () => void;
  onOpenPresets: () => void;
  onOpenSettings: () => void;
  onAddFillIn?: () => void;

  currentQuarter: Quarter;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  /** True when auto-subs are active and currently paused. */
  autoSubPaused?: boolean;
  /** Toggle pause/resume for the running plan. */
  onToggleAutoSubPause?: () => void;
  /** Final period flag — disables "Next break". */
  isFinalPeriod?: boolean;
}

/**
 * Slim in-game action bar for the netball board.
 *
 * Replaces the setup-oriented {@link NetballActionBar} once a match is
 * underway. Keeps only live coaching actions in the primary row — Sub,
 * Auto-subs, Next break — and tucks all setup-style actions (squad,
 * lineups, presets, settings) into a `More` overflow so they remain
 * accessible without competing visually with the court.
 */
export default function NetballLiveActionBar({
  onToggleSubMode,
  subModeActive = false,
  onNextBreak,
  onOpenAutoSubs,
  onUndo,
  canUndo = false,
  onOpenSummary,
  onOpenSquad,
  onOpenLineups,
  onOpenPresets,
  onOpenSettings,
  onAddFillIn,
  currentQuarter,
  rotationMode,
  rotationIntervalMinutes,
  autoSubPaused = false,
  onToggleAutoSubPause,
  isFinalPeriod = false,
}: NetballLiveActionBarProps) {
  const autoSubActive = rotationMode !== "off";

  return (
    <div className="flex items-center gap-1 px-1.5 py-1 border-t bg-card/80 backdrop-blur-sm pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      {/* Undo — leftmost, low-emphasis */}
      <Button
        size="sm"
        variant="ghost"
        className="h-9 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={onUndo}
        disabled={!canUndo || !onUndo}
        aria-label="Undo last action"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>

      {/* Sub Mode — persistent toggle. Bench glows + court tokens become
          swap targets while active; tap a player to arm, tap target to swap. */}
      <Button
        size="sm"
        variant={subModeActive ? "default" : "outline"}
        className={cn(
          "h-9 px-3 text-[11.5px] font-semibold flex-1 min-w-0",
          subModeActive && "ring-2 ring-primary/40 shadow-[0_0_12px_hsl(var(--primary)/0.35)]",
        )}
        onClick={onToggleSubMode}
        aria-pressed={subModeActive}
      >
        <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
        {subModeActive ? "Sub Mode · ON" : "Sub Mode"}
      </Button>

      <Button
        size="sm"
        variant={autoSubActive ? "secondary" : "outline"}
        className={cn(
          "h-9 px-2 text-[11px] font-semibold whitespace-nowrap",
          autoSubActive && autoSubPaused && "text-muted-foreground italic",
        )}
        onClick={onOpenAutoSubs}
        title={
          autoSubActive
            ? `Auto-subs every ${rotationIntervalMinutes}m`
            : "Set up auto-subs"
        }
      >
        <Repeat className="h-3.5 w-3.5 mr-1" />
        {autoSubActive ? (autoSubPaused ? "Paused" : "Auto") : "Auto"}
      </Button>

    </div>
  );
}
