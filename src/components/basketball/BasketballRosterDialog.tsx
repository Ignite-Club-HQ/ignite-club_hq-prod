import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  BasketballPlayer,
  BasketballPosition,
  BASKETBALL_POSITIONS,
  POSITION_COLORS,
} from "./types";
import { Save, AlertTriangle, Plus, X, UserPlus } from "lucide-react";

interface BasketballRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: BasketballPlayer[];
  onSave: (players: BasketballPlayer[]) => void;
}

/**
 * Mock players use this id prefix so they can be visually flagged and removed
 * from the squad without touching real team-member rows.
 */
const MOCK_ID_PREFIX = "mock-";

/**
 * Edit each player's jersey number, preferred positions, fouls, and injury flag.
 * Preferred positions are HINTS only in basketball — they bias the auto-sub
 * like-for-like swap logic but never block manual moves.
 *
 * Coaches can also add ad-hoc "mock" players here when their team roster is
 * incomplete (e.g. fill-ins, trialists, or training-only bodies). Mock
 * players persist into the live game just like real players.
 */
export default function BasketballRosterDialog({
  open,
  onOpenChange,
  players,
  onSave,
}: BasketballRosterDialogProps) {
  const [draft, setDraft] = useState<BasketballPlayer[]>(players);
  const [newName, setNewName] = useState("");

  const togglePosition = (playerId: string, pos: BasketballPosition) => {
    setDraft(prev =>
      prev.map(p => {
        if (p.id !== playerId) return p;
        const current = p.preferredPositions ?? [];
        const next = current.includes(pos)
          ? current.filter(x => x !== pos)
          : [...current, pos];
        return { ...p, preferredPositions: next };
      })
    );
  };

  const updateNumber = (playerId: string, raw: string) => {
    const num = raw === "" ? undefined : Math.max(0, Math.min(99, Number(raw)));
    setDraft(prev =>
      prev.map(p => (p.id === playerId ? { ...p, number: Number.isNaN(num) ? undefined : num } : p))
    );
  };

  const updateFouls = (playerId: string, delta: number) => {
    setDraft(prev =>
      prev.map(p =>
        p.id === playerId
          ? { ...p, fouls: Math.max(0, Math.min(6, (p.fouls ?? 0) + delta)) }
          : p
      )
    );
  };

  const toggleInjured = (playerId: string) => {
    setDraft(prev =>
      prev.map(p => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
  };

  const addMockPlayer = (overrideName?: string) => {
    const trimmed = (overrideName ?? newName).trim();
    const mockCount = draft.filter(p => p.id.startsWith(MOCK_ID_PREFIX)).length;
    const fallback = `Mock ${mockCount + 1}`;
    const name = trimmed || fallback;
    const id = `${MOCK_ID_PREFIX}${Date.now()}-${mockCount}`;
    setDraft(prev => [
      ...prev,
      {
        id,
        name,
        position: null,
        minutesPlayed: 0,
        fouls: 0,
        points: 0,
        preferredPositions: [],
      },
    ]);
    setNewName("");
  };

  const removeMockPlayer = (playerId: string) => {
    setDraft(prev => prev.filter(p => p.id !== playerId));
  };

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Squad & Positions</DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground -mt-2">
          Tap roles you want this player to favour during auto-rotations.
          Empty = eligible for any position.
        </p>

        {/* Add mock player — for fill-ins or trialists not in the team roster. */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed bg-muted/20">
          <UserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Add mock player (name optional)"
            className="h-8 text-sm flex-1 min-w-0"
            maxLength={24}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMockPlayer();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => addMockPlayer()}
            className="h-8 px-2 shrink-0"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {draft.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-6">
                No players yet — add a mock player above to get started.
              </div>
            )}
            {draft.map(player => {
              const isMock = player.id.startsWith(MOCK_ID_PREFIX);
              return (
                <div
                  key={player.id}
                  className={cn(
                    "rounded-lg border p-3 space-y-2",
                    player.isInjured && "opacity-60 border-destructive/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      value={player.number ?? ""}
                      onChange={e => updateNumber(player.id, e.target.value)}
                      placeholder="#"
                      className="w-14 h-8 text-center text-sm"
                      aria-label={`${player.name} jersey number`}
                    />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{player.name}</span>
                      {isMock && (
                        <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          Mock
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={player.isInjured ? "destructive" : "ghost"}
                      className="h-7 px-2 text-[10px]"
                      onClick={() => toggleInjured(player.id)}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {player.isInjured ? "Injured" : "Fit"}
                    </Button>
                    {isMock && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeMockPlayer(player.id)}
                        aria-label={`Remove ${player.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Fouls</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0 text-xs"
                      onClick={() => updateFouls(player.id, -1)}
                      disabled={(player.fouls ?? 0) <= 0}
                    >
                      −
                    </Button>
                    <span className="text-xs font-bold tabular-nums w-4 text-center">
                      {player.fouls ?? 0}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0 text-xs"
                      onClick={() => updateFouls(player.id, 1)}
                      disabled={(player.fouls ?? 0) >= 6}
                    >
                      +
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {BASKETBALL_POSITIONS.map(pos => {
                      const active = player.preferredPositions?.includes(pos);
                      const colors = POSITION_COLORS[pos];
                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => togglePosition(player.id, pos)}
                          className={cn(
                            "h-7 min-w-[34px] rounded-md border text-[11px] font-bold px-2 transition",
                            active
                              ? cn(colors.bg, colors.text, colors.border, "shadow-sm")
                              : "border-border text-muted-foreground hover:bg-muted"
                          )}
                          aria-pressed={active}
                          aria-label={`Toggle ${pos} for ${player.name}`}
                        >
                          {pos}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save squad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
