import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  NetballLineupPreset,
  NetballPlayer,
  NETBALL_POSITIONS,
} from "./types";

interface NetballLineupPresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: NetballPlayer[];
  presets: NetballLineupPreset[];
  onSave: (presets: NetballLineupPreset[]) => void;
  onApply: (preset: NetballLineupPreset) => void;
}

/**
 * Save / recall named 7-player units (e.g. "Starting 7", "Defensive set").
 * Snapshots the current on-court 7; one tap to apply later.
 */
export default function NetballLineupPresetsDialog({
  open,
  onOpenChange,
  players,
  presets,
  onSave,
  onApply,
}: NetballLineupPresetsDialogProps) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");

  const onCourt = useMemo(
    () => players.filter((p) => p.position !== null),
    [players]
  );

  const playerById = useMemo(() => {
    const map = new Map<string, NetballPlayer>();
    players.forEach((p) => map.set(p.id, p));
    return map;
  }, [players]);

  const canSaveCurrent = onCourt.length === 7 && newName.trim().length > 0;

  const handleSaveCurrent = () => {
    if (!canSaveCurrent) {
      toast({
        title: "Need 7 on court",
        description: `You have ${onCourt.length} on court. Fill all 7 positions first.`,
        variant: "destructive",
      });
      return;
    }
    const assignments: NetballLineupPreset["assignments"] = {};
    for (const p of onCourt) {
      if (p.position) assignments[p.position] = p.id;
    }
    const preset: NetballLineupPreset = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      assignments,
      createdAt: Date.now(),
    };
    onSave([preset, ...presets]);
    setNewName("");
    toast({ title: "Preset saved", description: `"${preset.name}" stored.` });
  };

  const handleDelete = (id: string) => {
    onSave(presets.filter((p) => p.id !== id));
  };

  const handleApply = (preset: NetballLineupPreset) => {
    onApply(preset);
    onOpenChange(false);
    toast({ title: "Lineup applied", description: `"${preset.name}" is on court.` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lineup presets</DialogTitle>
          <DialogDescription>
            Save the current 7 as a named unit. Apply it any time with one tap.
          </DialogDescription>
        </DialogHeader>

        {/* Save current */}
        <div className="flex gap-2 items-center">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Starting 7"
            maxLength={24}
            className="flex-1"
          />
          <Button onClick={handleSaveCurrent} size="sm" disabled={!canSaveCurrent}>
            <Plus className="h-4 w-4 mr-1" /> Save 7
          </Button>
        </div>
        {onCourt.length !== 7 && (
          <p className="text-xs text-muted-foreground -mt-2">
            {onCourt.length}/7 on court. Fill all positions to save.
          </p>
        )}

        {/* Existing presets */}
        <ScrollArea className="max-h-72 -mx-2">
          <div className="space-y-2 px-2">
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No presets saved yet.
              </p>
            ) : (
              presets.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-lg border bg-card p-2 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm flex-1 truncate">
                      {preset.name}
                    </span>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      onClick={() => handleApply(preset)}
                    >
                      <Zap className="h-3 w-3 mr-1" /> Apply
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(preset.id)}
                      aria-label="Delete preset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {NETBALL_POSITIONS.map((pos) => {
                      const id = preset.assignments[pos];
                      const p = id ? playerById.get(id) : undefined;
                      return (
                        <span
                          key={pos}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          <span className="font-bold">{pos}</span>{" "}
                          {p ? p.name.split(" ")[0] : "—"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
