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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_COLORS,
} from "./types";
import { Save, AlertTriangle } from "lucide-react";

interface NetballRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: NetballPlayer[];
  onSave: (players: NetballPlayer[]) => void;
}

/**
 * Edit each player's bib number, preferred positions, and injury flag.
 * This is what makes position validation actually meaningful.
 */
export default function NetballRosterDialog({
  open,
  onOpenChange,
  players,
  onSave,
}: NetballRosterDialogProps) {
  const [draft, setDraft] = useState<NetballPlayer[]>(players);

  const togglePosition = (playerId: string, pos: NetballPosition) => {
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

  const toggleInjured = (playerId: string) => {
    setDraft(prev =>
      prev.map(p => (p.id === playerId ? { ...p, isInjured: !p.isInjured } : p))
    );
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
          Tap positions a player can fill. Empty = eligible for all slots.
        </p>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {draft.map(player => (
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
                    aria-label={`${player.name} bib number`}
                  />
                  <span className="font-medium text-sm flex-1 truncate">{player.name}</span>
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
                </div>
                <div className="flex flex-wrap gap-1">
                  {NETBALL_POSITIONS.map(pos => {
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
            ))}
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
