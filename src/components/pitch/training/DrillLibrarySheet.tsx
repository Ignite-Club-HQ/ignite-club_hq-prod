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
import {
  Search,
  Trash2,
  Lock,
  Users,
  Building2,
  Loader2,
  Clock,
  Sparkles,
  Plus,
  Check,
  FilePlus2,
} from "lucide-react";
import {
  useDrillList,
  useDeleteDrill,
  useStampRecent,
  useSessionDrills,
  useAddToSession,
} from "@/hooks/useDrillLibrary";
import { loadDrill, type LibraryTab } from "./drillStorage";
import type { Drill } from "./types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DrillLibrarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId?: string | null;
  /** Called with a fully-loaded drill (frames included) */
  onOpenDrill: (drill: Drill) => void;
  /** Called when user wants to start a brand new drill from scratch */
  onNewDrill?: () => void;
}

const VIS_ICON = {
  private: Lock,
  team: Users,
  club: Building2,
  official: Sparkles,
} as const;

export function DrillLibrarySheet({
  open,
  onOpenChange,
  teamId,
  onOpenDrill,
  onNewDrill,
}: DrillLibrarySheetProps) {
  const [tab, setTab] = useState<LibraryTab>("ignite");
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  const { data: drills, isLoading } = useDrillList(tab, teamId ?? undefined, search);
  const { data: sessionDrills } = useSessionDrills();
  const deleteDrillMut = useDeleteDrill();
  const stampRecent = useStampRecent();
  const addToSessionMut = useAddToSession();

  const sessionDrillIds = new Set((sessionDrills ?? []).map((s) => s.drillId));

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

  const handleAddToSession = (drillId: string, name: string) => {
    if (sessionDrillIds.has(drillId)) {
      toast.info(`"${name}" is already in today's session`);
      return;
    }
    addToSessionMut.mutate(drillId, {
      onSuccess: () => toast.success(`Added "${name}" to today's session`),
      onError: (err: any) => toast.error(err?.message ?? "Failed to add"),
    });
  };

  const handleDelete = (drillId: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteDrillMut.mutate(drillId, {
      onSuccess: () => toast.success("Drill deleted"),
      onError: (err: any) => toast.error(err?.message ?? "Failed to delete"),
    });
  };

  const tabs: { value: LibraryTab; label: string }[] = [
    { value: "ignite", label: "Ignite" },
    { value: "mine", label: "Mine" },
    { value: "team", label: "Team" },
    { value: "recent", label: "Recent" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] flex flex-col p-0"
        // Prevent the search Input from auto-focusing on mobile (pops the keyboard)
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            Drill library
            {sessionDrills && sessionDrills.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                · {sessionDrills.length} in today's session
              </span>
            )}
          </SheetTitle>
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

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as LibraryTab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="mx-4 grid grid-cols-4 shrink-0">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                disabled={t.value === "team" && !teamId}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((t) => (
            <TabsContent
              key={t.value}
              value={t.value}
              className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mt-0"
            >
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !drills || drills.length === 0 ? (
                <EmptyState tab={t.value} hasTeam={!!teamId} />
              ) : (
                <ul className="space-y-2">
                  {drills.map((d) => {
                    const VisIcon = d.isOfficial ? Sparkles : VIS_ICON[d.visibility] ?? Lock;
                    const isOpening = openingId === d.id;
                    const inSession = sessionDrillIds.has(d.id);
                    return (
                      <li
                        key={d.id}
                        className="rounded-md border border-border bg-card hover:bg-muted/40 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleOpen(d.id)}
                          disabled={isOpening}
                          className="w-full text-left p-3"
                        >
                          <div className="flex items-center gap-2">
                            <VisIcon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                d.isOfficial ? "text-primary" : "text-muted-foreground"
                              )}
                            />
                            <span className="font-medium truncate flex-1">{d.name}</span>
                            {isOpening && (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            {d.ageGroup && <span>{d.ageGroup}</span>}
                            {d.durationMinutes != null && (
                              <span className="inline-flex items-center gap-0.5">
                                <Clock className="h-3 w-3" /> {d.durationMinutes}m
                              </span>
                            )}
                            {d.playersRequired != null && (
                              <span className="inline-flex items-center gap-0.5">
                                <Users className="h-3 w-3" /> {d.playersRequired}
                              </span>
                            )}
                            {d.focus.length > 0 && (
                              <span className="truncate">
                                {d.focus.slice(0, 3).join(" · ")}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 px-2 pb-2 -mt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={inSession ? "secondary" : "outline"}
                            onClick={() => handleAddToSession(d.id, d.name)}
                            disabled={inSession || addToSessionMut.isPending}
                            className="h-8 flex-1"
                          >
                            {inSession ? (
                              <>
                                <Check className="h-3.5 w-3.5 mr-1.5" />
                                In session
                              </>
                            ) : (
                              <>
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add to session
                              </>
                            )}
                          </Button>
                          {!d.isOfficial && (
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
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Footer: create-new escape hatch */}
        {onNewDrill && (
          <div className="shrink-0 border-t border-border px-4 py-3 bg-background">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onNewDrill();
                onOpenChange(false);
              }}
              className="w-full text-muted-foreground hover:text-foreground"
            >
              <FilePlus2 className="h-4 w-4 mr-1.5" />
              Create a new drill from scratch
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({ tab, hasTeam }: { tab: LibraryTab; hasTeam: boolean }) {
  const messages: Record<LibraryTab, string> = {
    ignite: "No drills found. Try a different search.",
    mine: "You haven't created any drills yet. Pick one from the Ignite library or create your own.",
    team: hasTeam
      ? "No team drills shared yet. Save a drill with 'Share with team' to make it appear here."
      : "Open Training Mode from a team to see team-shared drills.",
    recent: "No recently used drills. Open one from the library to see it here next time.",
  };
  return (
    <div className="text-center py-12 px-4 text-sm text-muted-foreground">{messages[tab]}</div>
  );
}
