import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  X,
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
import {
  applyDrillFilters,
  AGE_GROUP_OPTIONS,
  PLAYER_COUNT_OPTIONS,
  type AgeGroupFilter,
  type PlayerCountFilterValue,
} from "./drillFilters";

/**
 * On touch devices, when an overlay closes inside a tap handler the synthesized
 * `click` that follows can land on the element that was underneath the tap
 * (e.g. the pitch board's settings cog). Briefly intercept clicks at the
 * document root in the CAPTURE phase to swallow that ghost click.
 */
function blockGhostClicks(durationMs = 450) {
  if (typeof window === "undefined") return;
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    if (typeof (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === "function") {
      (e as Event & { stopImmediatePropagation: () => void }).stopImmediatePropagation();
    }
  };
  const opts: AddEventListenerOptions = { capture: true };
  const events = ["click", "mouseup", "pointerup", "touchend"] as const;
  events.forEach((evt) => window.addEventListener(evt, stop, opts));
  window.setTimeout(() => {
    events.forEach((evt) => window.removeEventListener(evt, stop, opts));
  }, durationMs);
}

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
  const [ageFilter, setAgeFilter] = useState<AgeGroupFilter>("all");
  const [playerFilter, setPlayerFilter] = useState<PlayerCountFilterValue>("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const { data: drills, isLoading } = useDrillList(tab, teamId ?? undefined, search);
  const filteredDrills = applyDrillFilters(drills, ageFilter, playerFilter);
  const filtersActive = ageFilter !== "all" || playerFilter !== "all";
  const { data: sessionDrills } = useSessionDrills();
  const deleteDrillMut = useDeleteDrill();
  const stampRecent = useStampRecent();
  const addToSessionMut = useAddToSession();

  const sessionDrillIds = new Set((sessionDrills ?? []).map((s) => s.drillId));

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const handleOpen = async (drillId: string) => {
    if (openingId) return; // ignore re-entrant taps
    setOpeningId(drillId);
    try {
      const drill = await loadDrill(drillId);
      stampRecent.mutate(drillId);
      // Close the sheet, then briefly block post-tap ghost clicks so they
      // cannot hit the pitch board controls underneath on touch devices.
      onOpenChange(false);
      blockGhostClicks();
      onOpenDrill(drill);
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

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000001] flex items-end" role="dialog" aria-modal="true" aria-label="Drill library">
      <button
        type="button"
        aria-label="Close drill library"
        className="absolute inset-0 bg-black/70"
        onClick={() => onOpenChange(false)}
      />

      <div className="relative z-[1000002] flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">Drill library</h2>
              {sessionDrills && sessionDrills.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {sessionDrills.length} in today's session
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Choose a ready-made drill or add one to today’s session.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close drill library">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-4 pb-2 shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drills..."
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={ageFilter} onValueChange={(v) => setAgeFilter(v as AgeGroupFilter)}>
              <SelectTrigger className="h-9 flex-1 text-xs" aria-label="Filter by age group">
                <SelectValue placeholder="All ages" />
              </SelectTrigger>
              <SelectContent className="z-[1000003]">
                {AGE_GROUP_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={playerFilter} onValueChange={(v) => setPlayerFilter(v as PlayerCountFilterValue)}>
              <SelectTrigger className="h-9 flex-1 text-xs" aria-label="Filter by player count">
                <SelectValue placeholder="Any number" />
              </SelectTrigger>
              <SelectContent className="z-[1000003]">
                {PLAYER_COUNT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAgeFilter("all");
                  setPlayerFilter("all");
                }}
                className="h-9 px-2 text-xs text-muted-foreground"
                aria-label="Clear filters"
              >
                Clear
              </Button>
            )}
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
              ) : !filteredDrills || filteredDrills.length === 0 ? (
                <EmptyState
                  tab={t.value}
                  hasTeam={!!teamId}
                  filtersActive={filtersActive}
                  onClearFilters={() => {
                    setAgeFilter("all");
                    setPlayerFilter("all");
                  }}
                />
              ) : (
                <ul className="space-y-2 pb-4">
                  {filteredDrills.map((d) => {
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
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleOpen(d.id);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          disabled={isOpening}
                          className="w-full text-left p-3 touch-manipulation"
                        >
                          <div className="flex items-center gap-2">
                            <VisIcon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                d.isOfficial ? "text-primary" : "text-muted-foreground"
                              )}
                            />
                            <span className="font-medium truncate flex-1 text-foreground">{d.name}</span>
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
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddToSession(d.id, d.name);
                            }}
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
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(d.id, d.name);
                              }}
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
      </div>
    </div>,
    document.body
  );
}

function EmptyState({
  tab,
  hasTeam,
  filtersActive,
  onClearFilters,
}: {
  tab: LibraryTab;
  hasTeam: boolean;
  filtersActive?: boolean;
  onClearFilters?: () => void;
}) {
  const messages: Record<LibraryTab, string> = {
    ignite: "No drills found. Try a different search.",
    mine: "You haven't created any drills yet. Pick one from the Ignite library or create your own.",
    team: hasTeam
      ? "No team drills shared yet. Save a drill with 'Share with team' to make it appear here."
      : "Open Training Mode from a team to see team-shared drills.",
    recent: "No recently used drills. Open one from the library to see it here next time.",
  };
  return (
    <div className="text-center py-12 px-4 text-sm text-muted-foreground space-y-2">
      <p>{filtersActive ? "No drills match your filters." : messages[tab]}</p>
      {filtersActive && onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
