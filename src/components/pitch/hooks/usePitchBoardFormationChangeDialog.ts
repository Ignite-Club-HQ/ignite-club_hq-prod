import { useCallback, useState, MutableRefObject } from "react";
import { Player, TeamSize } from "../types";
import { PitchPosition } from "../PositionBadge";

export interface PendingFormationChange {
  index: number;
  newTeamSize?: TeamSize;
  positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[];
  benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
  minorAdjustments?: { player: Player; fromLabel: string; toLabel: string }[];
}

interface Args {
  players: Player[];
  setPlayers: (p: Player[]) => void;
  setTeamSize: (s: TeamSize) => void;
  setSelectedFormation: (i: number) => void;
  autoPlacePlayersOnPitch: (players: Player[], teamSize: TeamSize, formationIndex: number) => Player[];
  persistTeamSizeToDb: (size: TeamSize) => void;
  notifyFormationOrSizeChange: (
    kind: 'formation' | 'team_size',
    value: string,
    details: {
      positionSwaps: PendingFormationChange["positionSwaps"];
      benchMoves: PendingFormationChange["benchMoves"];
    }
  ) => void;
  applyFormationChange: (
    index: number,
    changeDetails?: {
      positionSwaps: PendingFormationChange["positionSwaps"];
      benchMoves: PendingFormationChange["benchMoves"];
    }
  ) => void;
  setToolbarCollapsed: (v: boolean) => void;
  setPortraitSheetOpen: (v: boolean) => void;
  autoSubActive: boolean;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  toast: (opts: { title: string; description?: string }) => void;
}

export function usePitchBoardFormationChangeDialog(args: Args) {
  const {
    players, setPlayers, setTeamSize, setSelectedFormation,
    autoPlacePlayersOnPitch, persistTeamSizeToDb, notifyFormationOrSizeChange,
    applyFormationChange, setToolbarCollapsed, setPortraitSheetOpen,
    autoSubActive, regeneratePlanRef, toast,
  } = args;

  const [formationChangeDialogOpen, setFormationChangeDialogOpen] = useState(false);
  const [pendingFormationChange, setPendingFormationChange] = useState<PendingFormationChange | null>(null);

  const handleFormationChangeConfirm = useCallback(() => {
    if (pendingFormationChange) {
      if (pendingFormationChange.newTeamSize) {
        const newSize = pendingFormationChange.newTeamSize;
        setTeamSize(newSize);
        setSelectedFormation(0);
        const placedPlayers = autoPlacePlayersOnPitch(players, newSize, 0);
        setPlayers(placedPlayers);
        persistTeamSizeToDb(newSize);
        notifyFormationOrSizeChange('team_size', newSize, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      } else {
        applyFormationChange(pendingFormationChange.index, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      }
    }
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
    setToolbarCollapsed(true);
    setPortraitSheetOpen(false);

    if (autoSubActive) {
      setTimeout(() => {
        regeneratePlanRef.current?.();
        toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for formation change" });
      }, 300);
    }
  }, [pendingFormationChange, applyFormationChange, autoPlacePlayersOnPitch, players, setPlayers, setTeamSize, setSelectedFormation, persistTeamSizeToDb, autoSubActive, toast, notifyFormationOrSizeChange, setToolbarCollapsed, setPortraitSheetOpen, regeneratePlanRef]);

  const handleFormationChangeCancel = useCallback(() => {
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
  }, []);

  return {
    formationChangeDialogOpen,
    setFormationChangeDialogOpen,
    pendingFormationChange,
    setPendingFormationChange,
    handleFormationChangeConfirm,
    handleFormationChangeCancel,
  };
}
