import { useState } from "react";
import { Loader2, Utensils, Flag, PaintBucket, Megaphone, FileText } from "lucide-react";
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

const DUTY_OPTIONS = [
  { id: "Canteen", label: "Canteen", icon: Utensils, description: "Food & drinks" },
  { id: "Linesperson", label: "Linesperson", icon: Flag, description: "Line calls" },
  { id: "Linemarker", label: "Linemarker", icon: PaintBucket, description: "Mark the pitch" },
  { id: "Referee", label: "Referee", icon: Megaphone, description: "Officiate the game" },
  { id: "custom", label: "Other", icon: FileText, description: "Custom duty" },
];

interface AddDutySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddDuty: (dutyName: string) => void;
  isPending: boolean;
}

export function AddDutySheet({ open, onOpenChange, onAddDuty, isPending }: AddDutySheetProps) {
  const [selectedDuty, setSelectedDuty] = useState<string>("");
  const [customDutyName, setCustomDutyName] = useState("");

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
            {DUTY_OPTIONS.map((duty) => {
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

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
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
