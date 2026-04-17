import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  NETBALL_POSITION_LABELS,
  Quarter,
  QuarterLineup,
} from "./types";
import { snapshotLineup } from "./netballHelpers";
import { Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QuarterLineupPlannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: NetballPlayer[];
  lineups: QuarterLineup[];
  onSave: (lineups: QuarterLineup[]) => void;
}

const QUARTERS: Quarter[] = [1, 2, 3, 4];

export default function QuarterLineupPlanner({
  open,
  onOpenChange,
  players,
  lineups,
  onSave,
}: QuarterLineupPlannerProps) {
  const { toast } = useToast();
  const [activeQ, setActiveQ] = useState<Quarter>(1);
  const [draft, setDraft] = useState<QuarterLineup[]>(() => {
    // Seed with existing or empty lineups for all 4 quarters
    return QUARTERS.map(q => {
      const existing = lineups.find(l => l.quarter === q);
      return existing ?? { quarter: q, assignments: {}, createdAt: Date.now() };
    });
  });

  const updateAssignment = (q: Quarter, position: NetballPosition, playerId: string | "none") => {
    setDraft(prev =>
      prev.map(l => {
        if (l.quarter !== q) return l;
        const next = { ...l.assignments };
        // Remove playerId from any other position in this quarter
        for (const pos of NETBALL_POSITIONS) {
          if (next[pos] === playerId) delete next[pos];
        }
        if (playerId === "none") {
          delete next[position];
        } else {
          next[position] = playerId;
        }
        return { ...l, assignments: next, createdAt: Date.now() };
      })
    );
  };

  const copyFromCurrent = (q: Quarter) => {
    const snap = snapshotLineup(players, q);
    setDraft(prev => prev.map(l => (l.quarter === q ? snap : l)));
    toast({ title: `Q${q} captured`, description: "Current on-court 7 saved." });
  };

  const copyFromQuarter = (sourceQ: Quarter, targetQ: Quarter) => {
    setDraft(prev => {
      const source = prev.find(l => l.quarter === sourceQ);
      if (!source) return prev;
      return prev.map(l =>
        l.quarter === targetQ
          ? { quarter: targetQ, assignments: { ...source.assignments }, createdAt: Date.now() }
          : l
      );
    });
  };

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
    toast({ title: "Lineups saved", description: "All 4 quarter lineups updated." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Quarter Lineups</DialogTitle>
        </DialogHeader>

        <Tabs value={String(activeQ)} onValueChange={v => setActiveQ(Number(v) as Quarter)}>
          <TabsList className="grid grid-cols-4 w-full">
            {QUARTERS.map(q => {
              const lineup = draft.find(l => l.quarter === q);
              const filled = Object.keys(lineup?.assignments ?? {}).length;
              return (
                <TabsTrigger key={q} value={String(q)}>
                  Q{q} <span className="ml-1 text-[10px] opacity-60">{filled}/7</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {QUARTERS.map(q => {
            const lineup = draft.find(l => l.quarter === q)!;
            return (
              <TabsContent key={q} value={String(q)} className="flex-1 overflow-y-auto">
                <div className="flex gap-2 mb-3">
                  <Button size="sm" variant="outline" onClick={() => copyFromCurrent(q)}>
                    Use current 7
                  </Button>
                  {q > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyFromQuarter((q - 1) as Quarter, q)}
                    >
                      Copy Q{q - 1}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {NETBALL_POSITIONS.map(position => {
                    const selectedId = lineup.assignments[position] ?? "none";
                    const usedIds = new Set(
                      Object.entries(lineup.assignments)
                        .filter(([p]) => p !== position)
                        .map(([, id]) => id)
                    );
                    return (
                      <div key={position} className="flex items-center gap-3">
                        <span className="font-bold text-xs w-8">{position}</span>
                        <Select
                          value={selectedId}
                          onValueChange={v => updateAssignment(q, position, v as string)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Empty" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Empty —</SelectItem>
                            {players
                              .filter(p => !p.isInjured)
                              .map(p => (
                                <SelectItem
                                  key={p.id}
                                  value={p.id}
                                  disabled={usedIds.has(p.id)}
                                >
                                  {p.name}
                                  {p.preferredPositions?.includes(position) && " ⭐"}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-3">
                  ⭐ = preferred position. Tap "Use current 7" to capture the lineup on court right now.
                </p>
              </TabsContent>
            );
          })}
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save lineups
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
