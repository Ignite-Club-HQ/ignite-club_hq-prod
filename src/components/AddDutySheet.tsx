import { useState, useMemo } from "react";
import { Loader2, Utensils, Flag, PaintBucket, Megaphone, FileText, UserCog, Apple, Cookie, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

// All duty options with their metadata
const ALL_DUTY_OPTIONS = [
  { id: "Canteen/BBQ", label: "Canteen/BBQ", icon: Utensils, description: "Food & drinks" },
  { id: "Linesperson", label: "Linesperson", icon: Flag, description: "Line calls" },
  { id: "Linemarker", label: "Linemarker", icon: PaintBucket, description: "Mark the pitch" },
  { id: "Referee", label: "Referee", icon: Megaphone, description: "Officiate the game" },
  { id: "Subs Manager", label: "Subs Manager", icon: UserCog, description: "Pitch board access" },
  { id: "Game Steward", label: "Game Steward", icon: ShieldCheck, description: "Ground safety & conduct" },
  { id: "Oranges", label: "Oranges", icon: Apple, description: "Half-time oranges" },
  { id: "Snacks", label: "Snacks", icon: Cookie, description: "Snacks & treats" },
  { id: "custom", label: "Other", icon: FileText, description: "Custom duty" },
];

// Duties that support optional timed shifts (multiple slots throughout the event)
const SHIFT_CAPABLE_DUTIES = new Set(["Canteen/BBQ"]);

// For mini league session level: all duties available (auto-distributed to matches)
const MINI_LEAGUE_SESSION_DUTIES = ["Canteen/BBQ", "Linemarker", "Referee", "Linesperson", "Subs Manager", "Game Steward", "Oranges", "Snacks", "custom"];

// For mini league match level: only Referee and Linesperson
const MINI_LEAGUE_MATCH_DUTIES = ["Linesperson", "Referee", "Subs Manager", "Oranges", "Snacks"];

export type DutyContext = "session" | "match";

interface AddDutySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddDuty: (dutyName: string) => void;
  isPending: boolean;
  /** Whether this is for a mini league event */
  isMiniLeague?: boolean;
  /** Context: session (event level) or match (group level) */
  context?: DutyContext;
}

export function AddDutySheet({ 
  open, 
  onOpenChange, 
  onAddDuty, 
  isPending,
  isMiniLeague = false,
  context = "session",
}: AddDutySheetProps) {
  const [selectedDuty, setSelectedDuty] = useState<string>("");
  const [customDutyName, setCustomDutyName] = useState("");

  // Determine which duties to show based on context
  const dutyOptions = useMemo(() => {
    if (!isMiniLeague) {
      // Non-mini league events: show all duties
      return ALL_DUTY_OPTIONS;
    }
    
    // Mini league events: filter based on context
    const allowedIds = context === "match" 
      ? MINI_LEAGUE_MATCH_DUTIES 
      : MINI_LEAGUE_SESSION_DUTIES;
    
    return ALL_DUTY_OPTIONS.filter(duty => allowedIds.includes(duty.id));
  }, [isMiniLeague, context]);

  const handleSubmit = () => {
    if (selectedDuty === "custom") {
      if (customDutyName.trim()) {
        onAddDuty(customDutyName.trim());
      }
    } else if (selectedDuty) {
      onAddDuty(selectedDuty);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state when closing
      setSelectedDuty("");
      setCustomDutyName("");
    }
    onOpenChange(isOpen);
  };

  const isSubmitDisabled = !selectedDuty || (selectedDuty === "custom" && !customDutyName.trim()) || isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add Duty</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            {dutyOptions.map((duty) => {
              const Icon = duty.icon;
              const isSelected = selectedDuty === duty.id;
              
              return (
                <button
                  key={duty.id}
                  type="button"
                  onClick={() => setSelectedDuty(duty.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all",
                    "min-h-[100px] touch-manipulation",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-accent"
                  )}
                >
                  <div className={cn(
                    "p-3 rounded-full transition-colors",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-center">
                    <p className={cn(
                      "font-medium text-sm",
                      isSelected ? "text-primary" : "text-foreground"
                    )}>
                      {duty.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{duty.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDuty === "custom" && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="customDutyName">Custom Duty Name</Label>
              <Input
                id="customDutyName"
                value={customDutyName}
                onChange={(e) => setCustomDutyName(e.target.value)}
                placeholder="e.g. BBQ, Scorer, First Aid"
                className="h-12 text-base"
                autoFocus
              />
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0 sticky bottom-0 bg-background pt-3 pb-[env(safe-area-inset-bottom,0px)] border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Duty
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
