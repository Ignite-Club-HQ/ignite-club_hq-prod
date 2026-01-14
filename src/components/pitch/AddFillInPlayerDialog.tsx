import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";

interface AddFillInPlayerDialogProps {
  onAddPlayer: (player: { name: string; number?: number; positions: PitchPosition[] }) => void;
  existingNumbers: number[];
  compact?: boolean;
}

const POSITIONS: PitchPosition[] = ["GK", "DEF", "MID", "FWD"];

export default function AddFillInPlayerDialog({ 
  onAddPlayer, 
  existingNumbers,
  compact = false 
}: AddFillInPlayerDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [selectedPositions, setSelectedPositions] = useState<PitchPosition[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const playerNumber = number ? parseInt(number, 10) : undefined;
    onAddPlayer({
      name: name.trim(),
      number: playerNumber,
      positions: selectedPositions.length > 0 ? selectedPositions : ["MID"],
    });

    // Reset form
    setName("");
    setNumber("");
    setSelectedPositions([]);
    setOpen(false);
  };

  const togglePosition = (pos: PitchPosition) => {
    setSelectedPositions(prev => 
      prev.includes(pos) 
        ? prev.filter(p => p !== pos)
        : [...prev, pos]
    );
  };

  const suggestNumber = () => {
    for (let i = 1; i <= 99; i++) {
      if (!existingNumbers.includes(i)) return i;
    }
    return existingNumbers.length + 1;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size={compact ? "sm" : "default"}
          className={cn(
            "gap-1.5",
            compact && "h-7 text-xs px-2"
          )}
        >
          <UserPlus className={compact ? "h-3 w-3" : "h-4 w-4"} />
          {compact ? "Fill-In" : "Add Fill-In Player"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Fill-In Player</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fillInName">Player Name *</Label>
            <Input
              id="fillInName"
              placeholder="Enter player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="fillInNumber">Jersey Number</Label>
            <div className="flex gap-2">
              <Input
                id="fillInNumber"
                type="number"
                placeholder={`e.g. ${suggestNumber()}`}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                min={1}
                max={99}
                className="w-24"
              />
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={() => setNumber(suggestNumber().toString())}
              >
                Auto
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preferred Positions</Label>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map(pos => (
                <Badge
                  key={pos}
                  variant={selectedPositions.includes(pos) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer transition-colors",
                    selectedPositions.includes(pos) 
                      ? "bg-primary hover:bg-primary/90" 
                      : "hover:bg-muted"
                  )}
                  onClick={() => togglePosition(pos)}
                >
                  {pos}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Select positions this player can play. Defaults to MID if none selected.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Add to Bench
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
