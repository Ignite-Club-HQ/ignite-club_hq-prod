import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Label } from "@/components/ui/label";
import { X, Check, RotateCcw, Zap, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { Player, TeamSize, FORMATIONS, getPositionFromCoords } from "./types";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";

const TEAM_SIZES: TeamSize[] = ["3", "4", "5", "6", "7", "8", "9", "10", "11"];

interface PreGameLineupScreenProps {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  rotateGkAtHalftime: boolean;
  onConfirm: (players: Player[], firstHalfGkId?: string, secondHalfGkId?: string) => void;
  onSkip: () => void;
  onClose: () => void;
  onTeamSizeChange?: (size: TeamSize) => void;
  onFormationChange?: (index: number) => void;
}

interface FormationSlot {
  index: number;
  position: { x: number; y: number };
  pitchPosition: PitchPosition;
  assignedPlayerId: string | null;
}

// Position color map for pitch circles
const CIRCLE_COLORS: Record<PitchPosition, { empty: string; emptyBorder: string; filled: string; filledBorder: string }> = {
  GK: { empty: "bg-yellow-500/25", emptyBorder: "border-yellow-400/60", filled: "bg-yellow-600/90", filledBorder: "border-yellow-300/70" },
  DEF: { empty: "bg-blue-500/25", emptyBorder: "border-blue-400/60", filled: "bg-blue-600/90", filledBorder: "border-blue-300/70" },
  MID: { empty: "bg-emerald-500/25", emptyBorder: "border-emerald-400/60", filled: "bg-emerald-600/90", filledBorder: "border-emerald-300/70" },
  FWD: { empty: "bg-red-500/25", emptyBorder: "border-red-400/60", filled: "bg-red-600/90", filledBorder: "border-red-300/70" },
};

function buildSlots(formation: { positions: { x: number; y: number }[] } | undefined, teamSize: TeamSize): FormationSlot[] {
  if (!formation) return [];
  return formation.positions.map((pos, index) => ({
    index,
    position: pos,
    pitchPosition: getPositionFromCoords(pos.y, teamSize),
    assignedPlayerId: null,
  }));
}

export default function PreGameLineupScreen({
  players,
  teamSize,
  selectedFormation,
  rotateGkAtHalftime,
  onConfirm,
  onSkip,
  onClose,
  onTeamSizeChange,
  onFormationChange,
}: PreGameLineupScreenProps) {
  const formation = FORMATIONS[teamSize][selectedFormation];
  const hasGk = !["3", "4", "5", "6"].includes(teamSize);

  const initialSlots = useMemo(() => buildSlots(formation, teamSize), [formation, teamSize]);

  const [slots, setSlots] = useState<FormationSlot[]>(initialSlots);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [firstHalfGkId, setFirstHalfGkId] = useState<string | null>(null);
  const [secondHalfGkId, setSecondHalfGkId] = useState<string | null>(null);

  // Whether GK is managed via dropdown (not manual slot assignment)
  const gkManagedByDropdown = hasGk && rotateGkAtHalftime;

  // When 1st half GK is selected from dropdown, assign them to the GK slot on pitch
  const handleFirstHalfGkChange = useCallback((playerId: string) => {
    setFirstHalfGkId(playerId);
    // Find the GK slot and assign the player
    const gkSlotIndex = slots.findIndex(s => s.pitchPosition === "GK");
    if (gkSlotIndex >= 0) {
      setSlots(prev => prev.map((s, i) => {
        if (i === gkSlotIndex) return { ...s, assignedPlayerId: playerId };
        // If this player was assigned elsewhere, unassign them
        if (s.assignedPlayerId === playerId) return { ...s, assignedPlayerId: null };
        return s;
      }));
    }
  }, [slots]);

  // When formation/teamSize changes from parent, rebuild slots but try to keep assignments
  const handleTeamSizeChange = useCallback((newSize: TeamSize) => {
    const newFormation = FORMATIONS[newSize][0];
    const newSlots = buildSlots(newFormation, newSize);
    // Try to preserve assignments for slots that still exist
    const oldAssignments = slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!);
    let idx = 0;
    for (const slot of newSlots) {
      if (idx < oldAssignments.length) {
        slot.assignedPlayerId = oldAssignments[idx];
        idx++;
      }
    }
    setSlots(newSlots);
    setSelectedSlotIndex(null);
    setFirstHalfGkId(null);
    setSecondHalfGkId(null);
    onTeamSizeChange?.(newSize);
    onFormationChange?.(0);
  }, [slots, onTeamSizeChange, onFormationChange]);

  const handleFormationChange = useCallback((formationIndex: number) => {
    const newFormation = FORMATIONS[teamSize][formationIndex];
    const newSlots = buildSlots(newFormation, teamSize);
    // Preserve assignments
    const oldAssignments = slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!);
    let idx = 0;
    for (const slot of newSlots) {
      if (idx < oldAssignments.length) {
        slot.assignedPlayerId = oldAssignments[idx];
        idx++;
      }
    }
    setSlots(newSlots);
    setSelectedSlotIndex(null);
    onFormationChange?.(formationIndex);
  }, [teamSize, slots, onFormationChange]);

  // Track assigned player IDs
  const assignedPlayerIds = useMemo(
    () => new Set(slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!)),
    [slots]
  );

  // Bench players (not assigned to any slot)
  const benchPlayers = useMemo(
    () => players.filter(p => !assignedPlayerIds.has(p.id) && !p.isInjured),
    [players, assignedPlayerIds]
  );

  // GK-capable players (for rotation picker)
  const gkCapablePlayers = useMemo(
    () => players.filter(p => !p.isInjured && (!p.assignedPositions?.length || p.assignedPositions.includes("GK"))),
    [players]
  );

  // Check if player can play a position
  const canPlayPosition = useCallback((player: Player, pitchPos: PitchPosition): boolean => {
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(pitchPos);
  }, []);

  // Get filtered bench players for selected slot
  const filteredBenchPlayers = useMemo(() => {
    if (selectedSlotIndex === null) return benchPlayers;
    const slot = slots[selectedSlotIndex];
    if (!slot) return benchPlayers;
    
    return [...benchPlayers].sort((a, b) => {
      const aEligible = canPlayPosition(a, slot.pitchPosition);
      const bEligible = canPlayPosition(b, slot.pitchPosition);
      if (aEligible && !bEligible) return -1;
      if (!aEligible && bEligible) return 1;
      return 0;
    });
  }, [selectedSlotIndex, slots, benchPlayers, canPlayPosition]);

  // Handle tapping a slot
  const handleSlotTap = useCallback((slotIndex: number) => {
    const slot = slots[slotIndex];
    // Don't allow manual GK slot interaction when managed by dropdown
    if (gkManagedByDropdown && slot.pitchPosition === "GK") return;
    
    if (slot.assignedPlayerId) {
      setSlots(prev => prev.map((s, i) => i === slotIndex ? { ...s, assignedPlayerId: null } : s));
      if (slot.assignedPlayerId === firstHalfGkId) setFirstHalfGkId(null);
      if (slot.assignedPlayerId === secondHalfGkId) setSecondHalfGkId(null);
      setSelectedSlotIndex(null);
    } else {
      setSelectedSlotIndex(slotIndex);
    }
  }, [slots, firstHalfGkId, secondHalfGkId, gkManagedByDropdown]);

  // Handle picking a player for selected slot
  const handlePickPlayer = useCallback((playerId: string) => {
    let targetIndex = selectedSlotIndex;
    if (targetIndex === null) {
      const player = players.find(p => p.id === playerId);
      // Skip GK slots when managed by dropdown
      const skipGk = gkManagedByDropdown;
      const matchingSlot = player?.assignedPositions?.length
        ? slots.findIndex(s => !s.assignedPlayerId && player.assignedPositions!.includes(s.pitchPosition) && !(skipGk && s.pitchPosition === "GK"))
        : -1;
      if (matchingSlot !== undefined && matchingSlot >= 0) {
        targetIndex = matchingSlot;
      } else {
        targetIndex = slots.findIndex(s => !s.assignedPlayerId && !(skipGk && s.pitchPosition === "GK"));
      }
      if (targetIndex < 0) return;
    }
    
    const finalIndex = targetIndex;
    setSlots(prev => prev.map((s, i) =>
      i === finalIndex ? { ...s, assignedPlayerId: playerId } : s
    ));

    const slot = slots[finalIndex];
    if (slot.pitchPosition === "GK" && !firstHalfGkId) {
      setFirstHalfGkId(playerId);
    }

    setSelectedSlotIndex(null);
  }, [selectedSlotIndex, slots, firstHalfGkId, players]);

  // Auto-fill
  const handleAutoFill = useCallback(() => {
    const newSlots = [...slots];
    const used = new Set(newSlots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!));
    const available = players.filter(p => !used.has(p.id) && !p.isInjured);
    
    for (const slot of newSlots) {
      if (slot.assignedPlayerId) continue;
      const specialist = available.find(
        p => !used.has(p.id) && p.assignedPositions?.length === 1 && p.assignedPositions[0] === slot.pitchPosition
      );
      if (specialist) { slot.assignedPlayerId = specialist.id; used.add(specialist.id); continue; }
      const eligible = available.find(p => !used.has(p.id) && canPlayPosition(p, slot.pitchPosition));
      if (eligible) { slot.assignedPlayerId = eligible.id; used.add(eligible.id); continue; }
      const anyone = available.find(p => !used.has(p.id));
      if (anyone) { slot.assignedPlayerId = anyone.id; used.add(anyone.id); }
    }
    
    setSlots(newSlots);
    if (hasGk && !firstHalfGkId) {
      const gkSlot = newSlots.find(s => s.pitchPosition === "GK" && s.assignedPlayerId);
      if (gkSlot) setFirstHalfGkId(gkSlot.assignedPlayerId);
    }
  }, [slots, players, canPlayPosition, hasGk, firstHalfGkId]);

  const handleClearAll = useCallback(() => {
    setSlots(prev => prev.map(s => ({ ...s, assignedPlayerId: null })));
    setFirstHalfGkId(null);
    setSecondHalfGkId(null);
    setSelectedSlotIndex(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const updatedPlayers = players.map(player => {
      const slot = slots.find(s => s.assignedPlayerId === player.id);
      if (slot) {
        return { ...player, position: slot.position, currentPitchPosition: slot.pitchPosition };
      }
      return { ...player, position: null as { x: number; y: number } | null, currentPitchPosition: undefined };
    });
    onConfirm(updatedPlayers, firstHalfGkId || undefined, secondHalfGkId || undefined);
  }, [players, slots, firstHalfGkId, secondHalfGkId, onConfirm]);

  const filledSlots = slots.filter(s => s.assignedPlayerId).length;
  const totalSlots = slots.length;
  const getPlayerById = useCallback((id: string) => players.find(p => p.id === id), [players]);

  const formations = FORMATIONS[teamSize];

  return (
    <div className="fixed inset-0 z-[99999] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Starting Lineup</h2>
          <Badge variant="outline" className="text-xs">
            {filledSlots}/{totalSlots}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
            <span className="font-medium text-foreground">Lineup</span>
            <span className="text-muted-foreground/50 mx-0.5">→</span>
            <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">2</span>
            <span>Subs</span>
          </div>
        </div>
      </div>

      {/* Main content - fully scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Team size & formation selectors */}
        <div className="px-4 py-2 space-y-2 border-b border-border bg-muted/20">
          <div className="space-y-1">
            <Label id="team-size-label" className="text-[10px] uppercase tracking-wider text-muted-foreground">Players per Team</Label>
            <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-labelledby="team-size-label">
              {TEAM_SIZES.map(size => (
                <button
                  key={size}
                  className={cn(
                    "flex-1 min-h-[44px] text-sm font-medium transition-colors",
                    size === teamSize
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-foreground"
                  )}
                  aria-label={`${size} players per team`}
                  aria-pressed={size === teamSize}
                  onClick={() => handleTeamSizeChange(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label id="formation-label" className="text-[10px] uppercase tracking-wider text-muted-foreground">Formation</Label>
            <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-labelledby="formation-label">
              {formations.map((f, i) => (
                <button
                  key={i}
                  className={cn(
                    "flex-1 min-h-[44px] text-sm font-medium transition-colors",
                    i === selectedFormation
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-foreground"
                  )}
                  aria-label={`Formation ${f.name}`}
                  aria-pressed={i === selectedFormation}
                  onClick={() => handleFormationChange(i)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Formation visual - mini pitch with color-coded slots */}
        <div className="sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur-sm">
          <div className="px-4 py-2">
            <div className="relative w-full aspect-[3/4] max-h-[30vh] bg-[hsl(var(--pitch-green,120,40%,30%))] rounded-lg mx-auto max-w-sm" style={{ backgroundColor: '#2d5a27' }} role="group" aria-label={`Formation pitch view, ${filledSlots} of ${totalSlots} positions filled`}>
              {/* Pitch lines */}
              <div className="absolute inset-[8%] border-2 border-white/30 rounded" />
              <div className="absolute left-[8%] right-[8%] top-[50%] h-[1px] bg-white/30" />
              <div className="absolute left-[25%] right-[25%] top-[8%] h-[18%] border-2 border-white/20 rounded-b" />
              <div className="absolute left-[25%] right-[25%] bottom-[8%] h-[18%] border-2 border-white/20 rounded-t" />

              {/* Formation slots - color-coded by position */}
              {slots.map((slot, i) => {
                const player = slot.assignedPlayerId ? getPlayerById(slot.assignedPlayerId) : null;
                const isSelected = selectedSlotIndex === i;
                const colors = CIRCLE_COLORS[slot.pitchPosition];

                return (
                  <button
                    key={i}
                    className={cn(
                      "absolute w-14 h-14 -ml-7 -mt-7 rounded-full flex flex-col items-center justify-center transition-all text-white border-2",
                      player
                        ? cn(colors.filled, colors.filledBorder)
                        : isSelected
                          ? "bg-white/40 border-white animate-pulse"
                          : cn(colors.empty, colors.emptyBorder, "border-dashed")
                    )}
                    style={{ left: `${slot.position.x}%`, top: `${slot.position.y}%` }}
                    onClick={() => handleSlotTap(i)}
                    aria-label={player
                      ? `${slot.pitchPosition} position: ${player.name}. Tap to unassign`
                      : `Empty ${slot.pitchPosition} position. Tap to select`
                    }
                  >
                    {player ? (
                      <>
                        <span className="text-xs font-bold leading-none truncate max-w-[46px]">
                          {player.number || ""}
                        </span>
                        <span className="text-[9px] leading-none truncate max-w-[46px] mt-0.5">
                          {player.name.split(" ")[0]}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs font-bold text-white drop-shadow-sm">
                        {slot.pitchPosition}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-muted-foreground text-center">
              {selectedSlotIndex !== null
                ? `Assigning: ${slots[selectedSlotIndex]?.pitchPosition || "position"} — tap another circle to switch`
                : "Tap a position circle, then pick a player"}
            </p>
          </div>
        </div>

        {/* Player picker / GK rotation section */}
        <div className="border-t border-border">
          {/* GK Rotation picker - tap-to-select chips */}
          {hasGk && rotateGkAtHalftime && gkCapablePlayers.length >= 2 && (
            <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-3">
              <div className="space-y-1.5">
                <p id="first-half-gk-label" className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">1st Half GK</p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="first-half-gk-label">
                  {gkCapablePlayers.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 min-h-[44px] text-sm font-medium border transition-all",
                        firstHalfGkId === p.id
                          ? "bg-yellow-600/90 border-yellow-400/70 text-white shadow-sm"
                          : "bg-background border-border text-foreground hover:bg-muted/50 active:bg-muted/70"
                      )}
                      aria-label={`Select ${p.name} as 1st half goalkeeper`}
                      aria-pressed={firstHalfGkId === p.id}
                      onClick={() => handleFirstHalfGkChange(p.id)}
                    >
                      <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {p.number || "#"}
                      </span>
                      {p.name.split(" ")[0]}
                      {firstHalfGkId === p.id && <Check className="h-3.5 w-3.5 ml-0.5" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p id="second-half-gk-label" className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">2nd Half GK</p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="second-half-gk-label">
                  {gkCapablePlayers.filter(p => p.id !== firstHalfGkId).map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 min-h-[44px] text-sm font-medium border transition-all",
                        secondHalfGkId === p.id
                          ? "bg-yellow-600/90 border-yellow-400/70 text-white shadow-sm"
                          : "bg-background border-border text-foreground hover:bg-muted/50 active:bg-muted/70"
                      )}
                      aria-label={`Select ${p.name} as 2nd half goalkeeper`}
                      aria-pressed={secondHalfGkId === p.id}
                      onClick={() => setSecondHalfGkId(p.id)}
                    >
                      <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {p.number || "#"}
                      </span>
                      {p.name.split(" ")[0]}
                      {secondHalfGkId === p.id && <Check className="h-3.5 w-3.5 ml-0.5" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Player list header */}
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {selectedSlotIndex !== null
                ? `Pick player for ${slots[selectedSlotIndex]?.pitchPosition}`
                : "Tap a player to auto-assign, or tap a position first"
              }
            </p>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" className="h-11 text-sm px-3" onClick={handleAutoFill} aria-label="Auto-fill all positions">
                <Zap className="h-4 w-4 mr-1" />
                Auto
              </Button>
              <Button variant="ghost" size="sm" className="h-11 text-sm px-3" onClick={handleClearAll} aria-label="Clear all assigned players">
                <RotateCcw className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Player list - inline, scrolls with page */}
          <div className="px-4 pb-4 space-y-1">
            {filteredBenchPlayers.length === 0 && selectedSlotIndex !== null ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All players assigned! Tap an occupied position to swap.
              </p>
            ) : filteredBenchPlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No available players
              </p>
            ) : (
              filteredBenchPlayers.map(player => {
                const selectedSlot = selectedSlotIndex !== null ? slots[selectedSlotIndex] : null;
                const isEligible = selectedSlot ? canPlayPosition(player, selectedSlot.pitchPosition) : true;

                return (
                  <button
                    key={player.id}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 min-h-[48px] rounded-lg border transition-all text-left",
                      selectedSlotIndex === null
                        ? "border-border bg-muted/30 hover:bg-muted/50 active:bg-muted/70"
                        : isEligible
                          ? "border-primary/30 bg-primary/5 hover:bg-primary/10 active:bg-primary/20"
                          : "border-border bg-muted/30 opacity-50"
                    )}
                    onClick={() => handlePickPlayer(player.id)}
                    aria-label={`${player.name}, number ${player.number || 'unassigned'}${player.assignedPositions?.length ? `, plays ${player.assignedPositions.join(', ')}` : ', any position'}${!isEligible && selectedSlotIndex !== null ? ', not eligible for this position' : ''}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {player.number || "#"}
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-tight">{player.name}</p>
                        <div className="flex gap-1 mt-0.5">
                          {player.assignedPositions?.length ? (
                            player.assignedPositions.map(pos => {
                              const posColors = POSITION_COLORS[pos];
                              return (
                                <span key={pos} className={cn("text-[9px] font-bold px-1 py-0.5 rounded", posColors.bg, posColors.text)}>
                                  {pos}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-[9px] text-muted-foreground">Any position</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {selectedSlotIndex !== null && isEligible && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border flex gap-2 shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        <Button variant="outline" className="flex-1" onClick={onSkip}>
          Skip
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={filledSlots === 0}
        >
          <Check className="h-4 w-4 mr-1.5" />
          Confirm Lineup ({filledSlots}/{totalSlots})
        </Button>
      </div>
    </div>
  );
}
