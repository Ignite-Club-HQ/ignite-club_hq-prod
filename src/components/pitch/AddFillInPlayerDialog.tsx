import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface AddFillInPlayerDialogProps {
  onAddPlayer: (player: { name: string; number?: number; positions: PitchPosition[] }) => void;
  existingNumbers: number[];
  compact?: boolean;
  hideTrigger?: boolean;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
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
    <>
      <Button 
        variant="outline" 
        size={compact ? "sm" : "default"}
        className={cn(
          "gap-1.5 w-full",
          compact ? "h-7 text-xs px-2" : "h-10 text-sm"
        )}
        onClick={() => setOpen(true)}
      >
        <UserPlus className={compact ? "h-3 w-3" : "h-4 w-4"} />
        {compact ? "Fill-In" : "Add Fill-In Player"}
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-lg">Add Fill-In Player</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 px-4 sm:px-0 pb-4 sm:pb-0">
            <div className="space-y-1.5">
              <Label htmlFor="fillInName" className="text-sm font-medium">Player Name</Label>
              <Input
                id="fillInName"
                placeholder="Enter player name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-11"
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="fillInNumber" className="text-sm font-medium">Shirt Number</Label>
              <div className="flex gap-2">
                <Input
                  id="fillInNumber"
                  type="number"
                  placeholder={`e.g. ${suggestNumber()}`}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  min={1}
                  max={99}
                  className="w-24 h-11"
                />
                <Button 
                  type="button" 
                  variant="secondary" 
                  size="sm"
                  className="h-11 px-4"
                  onClick={() => setNumber(suggestNumber().toString())}
                >
                  Auto
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Preferred Positions</Label>
              <div className="flex gap-2">
                {POSITIONS.map(pos => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => togglePosition(pos)}
                    className={cn(
                      "flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors border",
                      selectedPositions.includes(pos) 
                        ? "bg-primary text-primary-foreground border-primary" 
                        : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    )}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Defaults to MID if none selected
              </p>
            </div>

            <Button 
              type="submit" 
              disabled={!name.trim()} 
              className="w-full h-11 text-base font-medium mt-2"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add to Bench
            </Button>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
