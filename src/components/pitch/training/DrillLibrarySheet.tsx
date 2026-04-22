import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Trash2, Lock, Users, Building2, Loader2, Clock } from "lucide-react";
import { useDrillList, useDeleteDrill, useStampRecent } from "@/hooks/useDrillLibrary";
import { loadDrill } from "./drillStorage";
import type { Drill } from "./types";
import { toast } from "sonner";

interface DrillLibrarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId?: string | null;
  /** Called with a fully-loaded drill (frames included) */
  onOpenDrill: (drill: Drill) => void;
}

const VIS_ICON = {
  private: Lock,
  team: Users,
  club: Building2,
} as const;

export function DrillLibrarySheet({
  open,
  onOpenChange,
  teamId,
  onOpenDrill,
}: DrillLibrarySheetProps) {
  const [tab, setTab] = useState<"mine" | "team" | "recent">("mine");
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  const { data: drills, isLoading } = useDrillList(tab, teamId ?? undefined, search);
  const deleteDrillMut = useDeleteDrill();
  const stampRecent = useStampRecent();

  const handleOpen = async (drillId: string) => {
    setOpeningId(drillId);
    try {
      const drill = await loadDrill(drillId);
      stampRecent.mutate(drillId);
      onOpenDrill(drill);
      onOpenChange(false);
    } catch (err: any) {
      console.error("[DrillLibrary] open failed", err);
      toast.error(err?.message ?? "Failed to open drill");
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = (drillId: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteDrillMut.mutate(drillId, {
      onSuccess: () => toast.success("Drill deleted"),
      onError: (err: any) => toast.error(err?.message ?? "Failed to delete"),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle>Drill library</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drills..."
              className="pl-8"
            />
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 grid grid-cols-3 shrink-0">
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="team" disabled={!teamId}>Team</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>

          {(["mine", "team", "recent"] as const).map((t) => (
            <TabsContent key={t} value={t} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mt-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !drills || drills.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {t === "mine" && "You haven't saved any drills yet."}
                  {t === "team" && "No team drills shared yet."}
                  {t === "recent" && "No recently used drills."}
                </div>
              ) : (
                <ul className="space-y-2">
                  {drills.map((d) => {
                    const VisIcon = VIS_ICON[d.visibility];
                    const isOpening = openingId === d.id;
                    return (
                      <li
                        key={d.id}
                        className="flex items-center gap-2 p-3 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleOpen(d.id)}
                          disabled={isOpening}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{d.name}</span>
                            <VisIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            {d.ageGroup && <span>{d.ageGroup}</span>}
                            {d.durationMinutes != null && (
                              <span className="inline-flex items-center gap-0.5">
                                <Clock className="h-3 w-3" /> {d.durationMinutes}m
                              </span>
                            )}
                            {d.focus.length > 0 && (
                              <span className="truncate">{d.focus.slice(0, 3).join(" · ")}</span>
                            )}
                          </div>
                        </button>
                        {isOpening ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(d.id, d.name)}
                            aria-label={`Delete ${d.name}`}
                            className="h-8 w-8 text-destructive shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
