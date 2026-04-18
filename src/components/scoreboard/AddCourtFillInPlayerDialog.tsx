import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface AddCourtFillInPlayerDialogProps<P extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All sport positions, e.g. NETBALL_POSITIONS or BASKETBALL_POSITIONS. */
  positions: readonly P[];
  /** Numbers already in use, used to suggest the next free shirt number. */
  existingNumbers: number[];
  onAdd: (player: { name: string; number?: number; preferredPositions: P[] }) => void;
}

/**
 * Sport-agnostic "drop-in" player dialog for basketball + netball boards.
 * Mirrors the soccer AddFillInPlayerDialog UX: name + optional number +
 * preferred positions. The new player is added straight to the bench so
 * the coach can sub them on immediately.
 */
export default function AddCourtFillInPlayerDialog<P extends string>({
  open,
  onOpenChange,
  positions,
  existingNumbers,
  onAdd,
}: AddCourtFillInPlayerDialogProps<P>) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [selected, setSelected] = useState<P[]>([]);

  const suggestNumber = () => {
    for (let i = 1; i <= 99; i++) if (!existingNumbers.includes(i)) return i;
    return existingNumbers.length + 1;
  };

  const reset = () => {
    setName("");
    setNumber("");
    setSelected([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const num = number ? parseInt(number, 10) : undefined;
    onAdd({
      name: name.trim(),
      number: Number.isFinite(num as number) ? (num as number) : undefined,
      preferredPositions: selected,
    });
    reset();
    onOpenChange(false);
  };

  const toggle = (p: P) =>
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-lg">Add Fill-In Player</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 sm:px-0 pb-4 sm:pb-0">
          <div className="space-y-1.5">
            <Label htmlFor="courtFillInName" className="text-sm font-medium">
              Player Name
            </Label>
            <Input
              id="courtFillInName"
              placeholder="Enter player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="courtFillInNumber" className="text-sm font-medium">
              Bib / Shirt Number
            </Label>
            <div className="flex gap-2">
              <Input
                id="courtFillInNumber"
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
            <div className="flex flex-wrap gap-1.5">
              {positions.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => toggle(pos)}
                  className={cn(
                    "flex-1 min-w-[3rem] py-2.5 rounded-lg text-sm font-medium transition-colors border",
                    selected.includes(pos)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  {pos}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty if the player can fill any slot.
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
  );
}
