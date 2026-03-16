import { useState, useEffect } from "react";
import { Loader2, Wand2, User, Megaphone, Apple } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ParentMember {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

interface QuickSetupDutyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assignments: Record<string, string | null>) => void;
  isPending: boolean;
  parents: ParentMember[];
  playerCount: number;
}

const DUTIES = [
  { id: "Referee", label: "Referee", icon: Megaphone, description: "Officiate the games" },
  { id: "Oranges", label: "Oranges", icon: Apple, description: "Half-time oranges" },
];

export function QuickSetupDutyDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  parents,
  playerCount,
}: QuickSetupDutyDialogProps) {
  const [assignments, setAssignments] = useState<Record<string, string | null>>({
    Referee: null,
    Oranges: null,
  });
  const [expandedDuty, setExpandedDuty] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAssignments({ Referee: null, Oranges: null });
      setExpandedDuty(null);
    }
  }, [open]);

  const getAssigneeName = (dutyId: string) => {
    const userId = assignments[dutyId];
    if (!userId) return null;
    return parents.find(p => p.id === userId);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Quick Setup
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {playerCount} players will be split into balanced matches. Assign duties for each match:
          </p>

          <div className="space-y-3">
            {DUTIES.map((duty) => {
              const assignee = getAssigneeName(duty.id);
              const isExpanded = expandedDuty === duty.id;
              const Icon = duty.icon;

              return (
                <div key={duty.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setExpandedDuty(isExpanded ? null : duty.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                      "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      isExpanded
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2.5 rounded-full transition-colors",
                        isExpanded ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{duty.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {assignee ? assignee.display_name : "Tap to assign"}
                        </p>
                      </div>
                    </div>
                    {assignee && (
                      <Avatar className="h-8 w-8 border-2 border-primary">
                        <AvatarImage src={assignee.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {assignee.display_name?.charAt(0)?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </button>

                  {isExpanded && (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-1.5 pl-2">
                        {/* Skip / unassigned option */}
                        <button
                          type="button"
                          onClick={() => {
                            setAssignments(prev => ({ ...prev, [duty.id]: null }));
                            setExpandedDuty(null);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                            "touch-manipulation hover:bg-accent",
                            !assignments[duty.id] ? "bg-accent" : ""
                          )}
                        >
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <span className="text-sm text-muted-foreground">Auto-assign</span>
                        </button>

                        {parents.map((parent) => {
                          const isSelected = assignments[duty.id] === parent.id;
                          return (
                            <button
                              key={parent.id}
                              type="button"
                              onClick={() => {
                                setAssignments(prev => ({ ...prev, [duty.id]: parent.id }));
                                setExpandedDuty(null);
                              }}
                              className={cn(
                                "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                                "touch-manipulation hover:bg-accent",
                                isSelected ? "bg-primary/10" : ""
                              )}
                            >
                              <Avatar className={cn(
                                "h-8 w-8 border-2",
                                isSelected ? "border-primary" : "border-transparent"
                              )}>
                                <AvatarImage src={parent.avatar_url || undefined} />
                                <AvatarFallback className="text-xs bg-muted">
                                  {parent.display_name?.charAt(0)?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className={cn(
                                "text-sm font-medium",
                                isSelected ? "text-primary" : "text-foreground"
                              )}>
                                {parent.display_name}
                              </span>
                            </button>
                          );
                        })}

                        {parents.length === 0 && (
                          <p className="text-sm text-muted-foreground py-3 text-center">
                            No parents available
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(assignments)}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Generate Matches
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
