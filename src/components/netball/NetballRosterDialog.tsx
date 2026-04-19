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
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_COLORS,
} from "./types";
import { Save, AlertTriangle, Plus, X, UserPlus } from "lucide-react";

interface NetballRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: NetballPlayer[];
  onSave: (players: NetballPlayer[]) => void;
}

/**
 * Mock players use this id prefix so they can be visually flagged and removed
 * from the squad without touching real team-member rows. Mirrors basketball.
 */
const MOCK_ID_PREFIX = "mock-";

/**
 * Edit each player's bib number, preferred positions, and injury flag.
 * Coaches can also add ad-hoc "mock" players here when their team roster
 * is incomplete (fill-ins, trialists, training-only bodies). Mirrors
 * BasketballRosterDialog including the one-tap "Add 12" mock squad.
 */
export default function NetballRosterDialog({
  open,
  onOpenChange,
  players,
  onSave,
}: NetballRosterDialogProps) {
  const [draft, setDraft] = useState<NetballPlayer[]>(players);

  const togglePosition = (playerId: string, pos: NetballPosition) => {
    setDraft((prev) =>
      prev.map((p) => {
        if (p.id !== playerId) return p;
        const current = p.preferredPositions ?? [];
        const next = current.includes(pos)
          ? current.filter((x) => x !== pos)
          : [...current, pos];
        return { ...p, preferredPositions: next };
      })
    );
  };

  const updateNumber = (playerId: string, raw: string) => {
    const num = raw === "" ? undefined : Math.max(0, Math.min(99, Number(raw)));
    setDraft((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, number: Number.isNaN(num) ? undefined : num } : p
      )
    );
  };

  const toggleInjured = (playerId: string) => {
    setDraft((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
  };

  const buildMockPlayer = (index: number, baseTime: number): NetballPlayer => ({
    id: `${MOCK_ID_PREFIX}${baseTime}-${index}`,
    name: `Mock Player ${index + 1}`,
    position: null,
    minutesPlayed: 0,
    goals: 0,
    preferredPositions: [],
  });

  const fillMockSquad = () => {
    // Replace any existing mocks with a fresh squad of 12.
    // Real (non-mock) players are kept untouched at the top of the list.
    const real = draft.filter((p) => !p.id.startsWith(MOCK_ID_PREFIX));
    const baseTime = Date.now();
    const mocks = Array.from({ length: 12 }, (_, i) => buildMockPlayer(i, baseTime));
    setDraft([...real, ...mocks]);
  };

  const removeMockPlayer = (playerId: string) => {
    setDraft((prev) => prev.filter((p) => p.id !== playerId));
  };

  const removeAllMocks = () => {
    setDraft((prev) => prev.filter((p) => !p.id.startsWith(MOCK_ID_PREFIX)));
  };

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
  };

  const mockCount = draft.filter((p) => p.id.startsWith(MOCK_ID_PREFIX)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Squad & Positions</DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground -mt-2">
          Tap positions a player can fill. Empty = eligible for all slots.
        </p>

        {/* One-tap mock squad — for testing the board without a real roster. */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-dashed bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <UserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold leading-tight">Mock squad</div>
              <div className="text-[10px] text-muted-foreground">
                {mockCount > 0
                  ? `${mockCount} mock player${mockCount === 1 ? "" : "s"} added`
                  : "Fill the bench with 12 test players"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {mockCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                onClick={removeAllMocks}
              >
                Clear
              </Button>
            )}
            <Button type="button" size="sm" onClick={fillMockSquad} className="h-8 px-2">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add 12
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {draft.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-6">
                No players yet — add a mock player above to get started.
              </div>
            )}
            {draft.map((player) => {
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
                      onChange={(e) => updateNumber(player.id, e.target.value)}
                      placeholder="#"
                      className="w-14 h-8 text-center text-sm"
                      aria-label={`${player.name} bib number`}
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
                  <div className="flex flex-wrap gap-1">
                    {NETBALL_POSITIONS.map((pos) => {
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
