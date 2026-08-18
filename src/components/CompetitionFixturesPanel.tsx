import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trophy, CalendarPlus, Save, X, AlertTriangle, ChevronDown, ChevronRight, Shuffle, RefreshCw, Trash2, Pencil, Settings2, CalendarDays, MoreHorizontal, MapPin, Clock, Info, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  buildRoundRobinPairings,
  scheduleFixtures,
  placeFinalsFixtures,
  buildFinalsSeedPairings,
  parseTimeToMins,
  dateKey,
  type Frequency,
  type SchedulingMode,
  type OccupiedSlot,
  type PlacedFixture,
  type FinalsFormat,
} from "@/lib/competitionScheduler";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

function TeamAvatar({
  name,
  logoUrl,
  initials,
  size = 32,
}: {
  name: string;
  logoUrl?: string | null;
  initials: string;
  size?: number;
}) {
  const dim = { width: size, height: size };
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        style={dim}
        className="rounded-full object-cover bg-muted shrink-0 ring-1 ring-border/40"
      />
    );
  }
  return (
    <div
      style={dim}
      className="rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0"
    >
      {initials || "?"}
    </div>
  );
}



function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  competitionId: string;
  isAdmin: boolean;
  divisions: any[];
  entries: any[]; // includes teams:team_id(id,name)
  source?: string;
}

export function CompetitionFixturesPanel({ competitionId, isAdmin, divisions, entries, source }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [genOpen, setGenOpen] = useState(false);
  const [genDivisionId, setGenDivisionId] = useState<string>("");
  const [genFirstRoundDate, setGenFirstRoundDate] = useState<string>("");
  const [genDayStart, setGenDayStart] = useState<string>("09:00");
  const [genDayEnd, setGenDayEnd] = useState<string>("16:00");
  const [genWeekdays, setGenWeekdays] = useState<number[]>([]); // empty = any
  const [weekdaysDirty, setWeekdaysDirty] = useState(false);
  const [genFrequency, setGenFrequency] = useState<Frequency>("weekly");
  const [genCustomDays, setGenCustomDays] = useState<string>("7");
  const [genEndDate, setGenEndDate] = useState<string>("");
  const [genStartRound, setGenStartRound] = useState<string>("1");
  const [genVenue, setGenVenue] = useState<string>("");
  const [genDuration, setGenDuration] = useState<string>("60");
  const [genArrival, setGenArrival] = useState<string>("");
  const [genAutoPitches, setGenAutoPitches] = useState<string>("");
  const [genPitchLabelsInput, setGenPitchLabelsInput] = useState<string>("");
  const [genMode, setGenMode] = useState<SchedulingMode>("stagger");
  const [genMaxRounds, setGenMaxRounds] = useState<string>(""); // empty = full round-robin
  const [genAddFinals, setGenAddFinals] = useState<boolean>(false);
  const [genFinalsFormat, setGenFinalsFormat] = useState<FinalsFormat>("gf");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0); // bumped on "Shuffle"
  const [previewPairings, setPreviewPairings] = useState<{ round: number; home: string; away: string; homeName: string; awayName: string }[] | null>(null);
  const [roundDateOverrides, setRoundDateOverrides] = useState<Map<number, string>>(new Map());

  const { data: matches = [], isLoading, isError } = useQuery({
    queryKey: ["competition-matches", competitionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_matches")
        .select("*, home:home_team_id(id, name, logo_url), away:away_team_id(id, name, logo_url), competition_divisions:division_id(name)")
        .eq("competition_id", competitionId)
        .order("round_number", { ascending: true, nullsFirst: false })
        .order("scheduled_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const acceptedByDivision = (divisionId: string | null) =>
    entries
      .filter((e: any) => e.status === "accepted" && (divisionId ? e.division_id === divisionId : true))
      .map((e: any) => e.teams)
      .filter(Boolean);

  const teamsInScope = acceptedByDivision(genDivisionId || null);
  const customDaysNum = Math.max(1, Number(genCustomDays) || 7);
  const durationNum = Math.max(0, Number(genDuration) || 0);
  const customPitchLabels = genPitchLabelsInput
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const manualPitchCount = Math.max(0, Number(genAutoPitches) || 0);
  const autoPitchCount = Math.max(1, Math.floor(teamsInScope.length / 2));
  const effectivePitchCount = customPitchLabels.length > 0
    ? customPitchLabels.length
    : (manualPitchCount > 0 ? manualPitchCount : autoPitchCount);
  const pitchLabels = customPitchLabels.length > 0
    ? customPitchLabels
    : Array.from({ length: effectivePitchCount }, (_, i) => String(i + 1));
  const pitchCount = pitchLabels.length;

  // Pre-fill division defaults when a division is picked
  const selectedDivision = useMemo(
    () => divisions.find((d: any) => d.id === genDivisionId) ?? null,
    [divisions, genDivisionId]
  );
  useEffect(() => {
    if (!selectedDivision) return;
    if (selectedDivision.day_start_time) setGenDayStart(String(selectedDivision.day_start_time).slice(0, 5));
    if (selectedDivision.day_end_time) setGenDayEnd(String(selectedDivision.day_end_time).slice(0, 5));
    if (!weekdaysDirty && Array.isArray(selectedDivision.play_weekdays)) {
      setGenWeekdays([...selectedDivision.play_weekdays].sort());
    }
  }, [selectedDivision, weekdaysDirty]);

  // Compute occupied pitch slots from existing matches in this competition
  // (so newly generated divisions don't clash with already-scheduled ones).
  const occupiedByDate = useMemo(() => {
    const m = new Map<string, OccupiedSlot[]>();
    for (const row of matches as any[]) {
      if (!row.scheduled_at || !row.pitch_number) continue;
      const d = new Date(row.scheduled_at);
      if (isNaN(d.getTime())) continue;
      const key = dateKey(d);
      const startMins = d.getHours() * 60 + d.getMinutes();
      const dur = Number(row.duration_minutes) > 0 ? Number(row.duration_minutes) : 60;
      const list = m.get(key) ?? [];
      list.push({ startMins, endMins: startMins + dur, pitch: String(row.pitch_number) });
      m.set(key, list);
    }
    return m;
  }, [matches]);

  // Build pairings once teams are chosen; re-runs on shuffle/regenerate
  const pairings = useMemo(() => {
    if (teamsInScope.length < 2) return [];
    const ids = shuffleSeed > 0
      ? shuffleArray(teamsInScope.map((t: any) => t.id))
      : teamsInScope.map((t: any) => t.id);
    const all = buildRoundRobinPairings(ids);
    const maxR = Math.max(0, Number(genMaxRounds) || 0);
    if (maxR > 0) return all.filter((p) => p.round <= maxR);
    return all;
  }, [teamsInScope, shuffleSeed, genMaxRounds]);

  // Live scheduling pass: same logic used at save time
  const schedule = useMemo(() => {
    if (pairings.length === 0) return null;
    const dayStartMins = parseTimeToMins(genDayStart, 9 * 60);
    const dayEndMins = parseTimeToMins(genDayEnd, 16 * 60);
    if (dayEndMins <= dayStartMins) return null;
    const start = genFirstRoundDate ? new Date(`${genFirstRoundDate}T00:00:00`) : null;
    const end = genEndDate ? new Date(`${genEndDate}T23:59:59`) : null;
    return scheduleFixtures({
      pairings,
      startDate: start,
      endDate: end,
      allowedWeekdays: genWeekdays,
      dayStartMins,
      dayEndMins,
      durationMins: durationNum || 60,
      pitchCount,
      pitchLabels,
      frequency: genFrequency,
      customDays: customDaysNum,
      mode: genMode,
      occupiedByDate,
      roundDateOverrides,
    });
  }, [pairings, genFirstRoundDate, genEndDate, genWeekdays, genDayStart, genDayEnd, durationNum, pitchCount, pitchLabels, genFrequency, customDaysNum, genMode, occupiedByDate, roundDateOverrides]);

  // Finals fixtures (placeholder/TBD teams), placed on the next allowed day
  // strictly after the last regular round's last date.
  const finalsPlaced = useMemo<PlacedFixture[]>(() => {
    if (!genAddFinals || !schedule || schedule.placed.length === 0) return [];
    // Find the last scheduled date across regular rounds
    let last: Date | null = null;
    for (const p of schedule.placed) {
      if (p.scheduledAt && (!last || p.scheduledAt.getTime() > last.getTime())) last = p.scheduledAt;
    }
    if (!last) return [];
    const lastRegularRound = Math.max(...schedule.placed.map((p) => p.round));
    const dayStartMins = parseTimeToMins(genDayStart, 9 * 60);
    const dayEndMins = parseTimeToMins(genDayEnd, 16 * 60);
    // Use a fresh local copy so we don't mutate the memo's pool
    const pool = new Map<string, OccupiedSlot[]>();
    occupiedByDate.forEach((v, k) => pool.set(k, [...v]));
    for (const p of schedule.placed) {
      if (!p.scheduledAt || !p.pitch) continue;
      const key = dateKey(p.scheduledAt);
      const startMins = p.scheduledAt.getHours() * 60 + p.scheduledAt.getMinutes();
      const list = pool.get(key) ?? [];
      list.push({ startMins, endMins: startMins + (durationNum || 60), pitch: p.pitch });
      pool.set(key, list);
    }
    return placeFinalsFixtures({
      round: lastRegularRound + 1,
      format: genFinalsFormat,
      afterDate: last,
      allowedWeekdays: genWeekdays,
      dayStartMins,
      dayEndMins,
      durationMins: durationNum || 60,
      pitchLabels,
      occupiedByDate: pool,
    });
  }, [genAddFinals, genFinalsFormat, schedule, genDayStart, genDayEnd, genWeekdays, durationNum, pitchLabels, occupiedByDate]);

  const allPlaced = useMemo<PlacedFixture[]>(
    () => (schedule ? [...schedule.placed, ...finalsPlaced] : []),
    [schedule, finalsPlaced]
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teamsInScope as any[]) m.set(t.id, t.name);
    return m;
  }, [teamsInScope]);

  const summary = useMemo(() => {
    if (!schedule) return null;
    const totalRounds = new Set(schedule.placed.map((p) => p.round)).size;
    const datedRounds = schedule.roundSummaries.filter((s) => s.dates.length > 0);
    const firstDate = datedRounds[0]?.dates[0]
      ? new Date(`${datedRounds[0].dates[0]}T00:00:00`)
      : null;
    const lastRoundDates = datedRounds[datedRounds.length - 1]?.dates ?? [];
    const finishDate = lastRoundDates.length
      ? new Date(`${lastRoundDates[lastRoundDates.length - 1]}T00:00:00`)
      : null;
    return {
      teamCount: teamsInScope.length,
      rounds: totalRounds + (finalsPlaced.length > 0 ? 1 : 0),
      totalMatches: schedule.placed.length + finalsPlaced.length,
      finalsCount: finalsPlaced.length,
      firstDate,
      finishDate,
      overflowRounds: schedule.overflowRounds,
      unscheduledCount: schedule.unscheduled.length,
    };
  }, [schedule, teamsInScope.length, finalsPlaced]);

  // Map placed fixtures by round → list ordered by scheduled_at.
  // Keep this before any conditional return so hook order is stable while the
  // fixtures query moves from loading to loaded.
  const placedByRound = useMemo(() => {
    const m = new Map<number, PlacedFixture[]>();
    for (const p of allPlaced) {
      if (!m.has(p.round)) m.set(p.round, []);
      m.get(p.round)!.push(p);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ta = a.scheduledAt?.getTime() ?? 0;
        const tb = b.scheduledAt?.getTime() ?? 0;
        if (ta !== tb) return ta - tb;
        return (a.pitch ?? "").localeCompare(b.pitch ?? "");
      });
    }
    return m;
  }, [allPlaced]);

  const finalsRoundNumber = useMemo(
    () => (finalsPlaced.length > 0 ? finalsPlaced[0].round : null),
    [finalsPlaced]
  );

  const toggleWeekday = (d: number) => {
    setWeekdaysDirty(true);
    setGenWeekdays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const setRoundDate = (round: number, isoDate: string) => {
    setRoundDateOverrides((prev) => {
      const next = new Map(prev);
      if (!isoDate) next.delete(round);
      else next.set(round, isoDate);
      return next;
    });
  };

  const onPreview = () => {
    if (!genVenue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    if (teamsInScope.length < 2) {
      toast({ title: "Need at least 2 accepted teams", variant: "destructive" });
      return;
    }
    const rows = pairings.map((p) => ({
      round: p.round,
      home: p.home,
      away: p.away,
      homeName: nameById.get(p.home) ?? "?",
      awayName: nameById.get(p.away) ?? "?",
    }));
    setPreviewPairings(rows);
  };
  const onShuffle = () => { setShuffleSeed((s) => s + 1); setRoundDateOverrides(new Map()); };
  const onRegenerate = () => { setShuffleSeed(0); setRoundDateOverrides(new Map()); };

  const saveFixtures = async () => {
    if (!schedule || !previewPairings) return;
    // In simultaneous mode, surface overflow before saving so the organiser
    // can confirm — same-day waves first, then cross-day overflow.
    if (genMode === "simultaneous") {
      if (schedule.extraWaveRounds.length > 0) {
        const rs = schedule.extraWaveRounds.join(", ");
        const ok = window.confirm(
          `Not all matches fit in a single kickoff wave. Round${schedule.extraWaveRounds.length === 1 ? "" : "s"} ${rs} will run extra time slots on the same day. Continue?`
        );
        if (!ok) return;
      }
      if (schedule.overflowRounds.length > 0) {
        const rs = schedule.overflowRounds.join(", ");
        const ok = window.confirm(
          `Round${schedule.overflowRounds.length === 1 ? "" : "s"} ${rs} won't fit in one day and will roll over to the next allowed weekday for this division. Continue?`
        );
        if (!ok) return;
      }
    }
    setGenerating(true);
    const arrival = genArrival ? Number(genArrival) : null;
    const startRoundOffset = Math.max(1, Number(genStartRound) || 1) - 1;
    const rows = allPlaced.map((p) => ({
      competition_id: competitionId,
      division_id: genDivisionId || null,
      round_number: startRoundOffset + p.round,
      home_team_id: p.home,
      away_team_id: p.away,
      status: "scheduled",
      created_by: user?.id ?? null,
      scheduled_at: p.scheduledAt ? p.scheduledAt.toISOString() : null,
      venue: genVenue,
      pitch_number: p.pitch,
      duration_minutes: durationNum || null,
      arrival_minutes_before: arrival,
      notes: p.note ?? null,
    }));
    if (rows.length === 0) {
      setGenerating(false);
      toast({ title: "No fixtures fit the window", description: "Widen the time window, add weekdays, or push the end date.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("competition_matches").insert(rows);
    setGenerating(false);
    if (error) {
      const raw = (error.message || "").toLowerCase();
      let description = "Something went wrong while saving these fixtures. Please try again in a moment.";
      if (raw.includes("duplicate") || raw.includes("unique")) {
        description = "Some of these fixtures already exist for this competition. Try regenerating or shuffling first.";
      } else if (raw.includes("permission") || raw.includes("row-level") || raw.includes("not authorized")) {
        description = "You don't have permission to save fixtures for this competition.";
      } else if (raw.includes("network") || raw.includes("fetch")) {
        description = "We couldn't reach the server. Check your connection and try again.";
      }
      toast({ title: "Couldn't save fixtures", description, variant: "destructive" });
      return;
    }
    toast({ title: `Saved ${rows.length} fixtures` });
    setGenOpen(false);
    setPreviewPairings(null);
    setRoundDateOverrides(new Map());
    setGenDivisionId(""); setGenFirstRoundDate("");
    setGenDayStart("09:00"); setGenDayEnd("16:00");
    setGenWeekdays([]); setWeekdaysDirty(false);
    setGenFrequency("weekly"); setGenCustomDays("7"); setGenEndDate(""); setGenStartRound("1");
    setGenVenue(""); setGenDuration("60"); setGenArrival(""); setGenAutoPitches(""); setGenPitchLabelsInput("");
    setGenMaxRounds(""); setGenAddFinals(false); setGenFinalsFormat("gf");
    setAdvancedOpen(false);
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  if (isError) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <CalendarPlus className="h-8 w-8 text-destructive mx-auto" />
          <h3 className="text-sm font-semibold">Couldn't load fixtures</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Something went wrong loading the fixture list. Please check your connection and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalAccepted = entries.filter((e: any) => e.status === "accepted").length;
  const canGenerate = totalAccepted >= 2;

  const frequencyLabel: Record<Frequency, string> = {
    weekly: "every week",
    biweekly: "every 2 weeks",
    triweekly: "every 3 weeks",
    monthly: "every month",
    custom: `every ${customDaysNum} day${customDaysNum === 1 ? "" : "s"}`,
  };

  const weekdaySummary = genWeekdays.length === 0
    ? "any day"
    : genWeekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ");

  return (
    <div
      className="space-y-3 box-border"
      style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}
    >
      {isAdmin && source !== "playhq" && (
        <div className="space-y-2">
          {!genOpen ? (
            <div className="flex items-center justify-end gap-2">
              {!canGenerate && (
                <span className="text-[11px] text-muted-foreground flex-1">
                  Add at least 2 accepted teams to generate fixtures.
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-foreground gap-1">
                    <Settings2 className="h-4 w-4" />
                    <span className="text-[12px] font-medium">Manage</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    disabled={!canGenerate}
                    onClick={() => setGenOpen(true)}
                  >
                    <CalendarPlus className="h-4 w-4 mr-2" /> Generate round-robin
                  </DropdownMenuItem>
                  <AddMatchMenuItem competitionId={competitionId} entries={entries} divisions={divisions} />
                  <AddFinalsRoundMenuItem competitionId={competitionId} divisions={divisions} />

                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Card className="w-full">
              <CardContent className="p-4 space-y-4">
                {!previewPairings ? (
                  <>
                    <div>
                      <Label>Division (optional)</Label>
                      <Select
                        value={genDivisionId || "_all"}
                        onValueChange={(v) => {
                          setGenDivisionId(v === "_all" ? "" : v);
                          setWeekdaysDirty(false);
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="All accepted teams" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_all">All accepted teams</SelectItem>
                          {divisions.map((d: any) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedDivision && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Pre-filled from division settings. Override here just for this generation.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <Label>Competition starts</Label>
                          <Input type="date" value={genFirstRoundDate} onChange={(e) => setGenFirstRoundDate(e.target.value)} />
                        </div>
                        <div className="col-span-2">
                          <Label>Competition end date (optional)</Label>
                          <Input type="date" value={genEndDate} onChange={(e) => setGenEndDate(e.target.value)} />
                          <p className="text-xs text-muted-foreground mt-1">
                            Caps the season. Matches that don't fit will roll into a "could not schedule" note.
                          </p>
                        </div>

                        <div className="col-span-2">
                          <Label>Play days</Label>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {WEEKDAYS_SHORT.map((label, i) => {
                              const active = genWeekdays.includes(i);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => toggleWeekday(i)}
                                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                    active
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-background text-foreground border-border hover:bg-muted"
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {genWeekdays.length === 0
                              ? "No days selected — fixtures will land on whichever day the frequency lands on."
                              : `Rounds only land on: ${weekdaySummary}.`}
                          </p>
                        </div>

                        <div>
                          <Label>Earliest kickoff</Label>
                          <Input type="time" value={genDayStart} onChange={(e) => setGenDayStart(e.target.value)} />
                        </div>
                        <div>
                          <Label>Latest kickoff</Label>
                          <Input type="time" value={genDayEnd} onChange={(e) => setGenDayEnd(e.target.value)} />
                        </div>

                        <div>
                          <Label>Frequency</Label>
                          <Select value={genFrequency} onValueChange={(v) => setGenFrequency(v as Frequency)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="weekly">Weekly</SelectItem>
                              <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                              <SelectItem value="triweekly">Every 3 weeks</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Duration (mins)</Label>
                          <Input type="number" inputMode="numeric" min={0} value={genDuration} onChange={(e) => setGenDuration(e.target.value)} />
                        </div>
                        {genFrequency === "custom" && (
                          <div className="col-span-2">
                            <Label>Days between rounds</Label>
                            <Input type="number" inputMode="numeric" min={1} value={genCustomDays} onChange={(e) => setGenCustomDays(e.target.value)} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rounds & finals</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <Label>Max regular rounds (optional)</Label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={genMaxRounds}
                            onChange={(e) => setGenMaxRounds(e.target.value)}
                            placeholder={teamsInScope.length >= 2 ? `Full round-robin = ${teamsInScope.length % 2 === 0 ? teamsInScope.length - 1 : teamsInScope.length} rounds` : "e.g. 7"}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Cap the league phase. Leave blank for a full round-robin.
                          </p>
                        </div>
                        <div className="col-span-2 flex items-start gap-2 rounded-md border bg-muted/30 p-2.5">
                          <input
                            id="add-finals"
                            type="checkbox"
                            checked={genAddFinals}
                            onChange={(e) => setGenAddFinals(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-primary"
                          />
                          <label htmlFor="add-finals" className="flex-1 text-sm cursor-pointer">
                            <div className="font-medium">Add a finals round at the end</div>
                            <div className="text-xs text-muted-foreground">
                              Schedules a finals week on the next play day after the last regular round. Teams are TBD and locked in by final standings.
                            </div>
                          </label>
                        </div>
                        {genAddFinals && (
                          <div className="col-span-2">
                            <Label>Finals format</Label>
                            <Select value={genFinalsFormat} onValueChange={(v) => setGenFinalsFormat(v as FinalsFormat)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gf">Grand Final only (1 v 2)</SelectItem>
                                <SelectItem value="top4">Top 4 (1v2, 3v4)</SelectItem>
                                <SelectItem value="top6">Top 6 (1v2, 3v4, 5v6)</SelectItem>
                                <SelectItem value="top8">Top 8 (1v2, 3v4, 5v6, 7v8)</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                              {buildFinalsSeedPairings(genFinalsFormat).length} finals match{buildFinalsSeedPairings(genFinalsFormat).length === 1 ? "" : "es"} will be added with placeholder teams.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <Label>Default venue <span className="text-destructive">*</span></Label>
                        <AddressAutocomplete
                          value={genVenue}
                          onChange={setGenVenue}
                          onSelect={(a) => {
                            const full = [a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", ");
                            setGenVenue(full);
                          }}
                          placeholder="Search venue or address…"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Pick a place to attach a full address so each match event can be geocoded and mapped.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Scheduling mode</Label>
                      <RadioGroup value={genMode} onValueChange={(v) => setGenMode(v as SchedulingMode)} className="space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <RadioGroupItem value="simultaneous" id="mode-sim" className="mt-1" />
                          <div className="text-sm">
                            <div className="font-medium">Simultaneous kick-off</div>
                            <div className="text-xs text-muted-foreground">All matches start at the earliest kickoff. Overflow rolls to the next play day.</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <RadioGroupItem value="stagger" id="mode-stagger" className="mt-1" />
                          <div className="text-sm">
                            <div className="font-medium">Auto-stagger matches</div>
                            <div className="text-xs text-muted-foreground">Fills the day window with back-to-back slots across pitches.</div>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>

                    {summary && (
                      <Card className="bg-muted/40 border-dashed">
                        <CardContent className="p-3 space-y-1 text-sm">
                          <div className="font-semibold mb-1">Competition summary</div>
                          <div>· {summary.teamCount} teams</div>
                          <div>· {summary.rounds} rounds · {summary.totalMatches} matches</div>
                          {pitchCount > 0 && <div>· {pitchCount} pitches in shared pool</div>}
                          <div>· Matches {frequencyLabel[genFrequency]} on {weekdaySummary}</div>
                          <div>· Day window {genDayStart} – {genDayEnd}</div>
                          {summary.firstDate && <div>· Starts {format(summary.firstDate, "EEE d MMM yyyy")}</div>}
                          {summary.finishDate && <div>· Estimated finish {format(summary.finishDate, "EEE d MMM yyyy")}</div>}
                          {summary.overflowRounds.length > 0 && (
                            <div className="text-amber-700 dark:text-amber-400">
                              · Round{summary.overflowRounds.length === 1 ? "" : "s"} {summary.overflowRounds.join(", ")} span multiple days
                            </div>
                          )}
                          {summary.unscheduledCount > 0 && (
                            <div className="text-destructive">
                              · {summary.unscheduledCount} match{summary.unscheduledCount === 1 ? "" : "es"} couldn't fit before the end date
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between px-2">
                          <span>Advanced options</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Starting round #</Label>
                            <Input type="number" inputMode="numeric" min={1} value={genStartRound} onChange={(e) => setGenStartRound(e.target.value)} />
                          </div>
                          <div>
                            <Label>Arrive (mins before)</Label>
                            <Input type="number" inputMode="numeric" min={0} value={genArrival} onChange={(e) => setGenArrival(e.target.value)} placeholder="e.g. 30" />
                          </div>
                          <div className="col-span-2">
                            <Label>Available pitches / courts</Label>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={genAutoPitches}
                              onChange={(e) => setGenAutoPitches(e.target.value)}
                              placeholder="e.g. 2"
                              disabled={customPitchLabels.length > 0}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Caps simultaneous matches. Shared across divisions in this competition.
                            </p>
                          </div>
                          <div className="col-span-2">
                            <Label>Specific pitch numbers (optional)</Label>
                            <Input
                              value={genPitchLabelsInput}
                              onChange={(e) => setGenPitchLabelsInput(e.target.value)}
                              placeholder="e.g. 3, 5, 7 or A, B, C"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Comma-separated labels. Overrides the count above.
                            </p>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Each team plays every other team once. Fixtures, team events and RSVP tracking are created automatically.
                      </p>
                      <Collapsible open={learnMoreOpen} onOpenChange={setLearnMoreOpen}>
                        <CollapsibleTrigger asChild>
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                            {learnMoreOpen ? "Hide details" : "Learn more"}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-1">
                          <p className="text-xs text-muted-foreground">
                            Each round fills its play day from earliest kickoff onward across all available pitches. If a round needs more matches than the day fits, it overflows to the next allowed play day before the next round starts. Other divisions' existing matches reserve pitches in the shared pool, so two divisions on the same day won't double-book.
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={onPreview} disabled={!canGenerate}>
                        Preview fixtures
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-base">Fixture preview</div>
                      <Badge variant="secondary" className="text-xs font-medium">
                        {allPlaced.length} matches
                      </Badge>
                    </div>
                    {summary?.unscheduledCount ? (
                      <div className="text-xs text-destructive flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{summary.unscheduledCount} match{summary.unscheduledCount === 1 ? "" : "es"} won't fit before the end date — adjust before saving.</span>
                      </div>
                    ) : null}
                    <div className="space-y-3 max-h-[55vh] overflow-y-auto -mx-1 px-1">
                      {Array.from(placedByRound.entries()).map(([round, list]) => {
                        const isFinalsRound = finalsRoundNumber === round;
                        const playingIds = new Set<string>();
                        list.forEach((p) => { if (p.home) playingIds.add(p.home); if (p.away) playingIds.add(p.away); });
                        const byeTeams = isFinalsRound ? [] : teamsInScope.filter((t: any) => !playingIds.has(t.id));
                        const datesInRound = Array.from(new Set(list.map((p) => p.scheduledAt ? dateKey(p.scheduledAt) : "—")));
                        const overrideValue = roundDateOverrides.get(round) ?? (datesInRound[0] !== "—" ? datesInRound[0] : "");
                        return (
                          <div key={round} className="rounded-lg border bg-card overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b">
                              <div className="flex items-baseline gap-2 min-w-0">
                                <span className="text-sm font-semibold">
                                  {isFinalsRound ? `Finals (Round ${round})` : `Round ${round}`}
                                </span>
                                <span className="text-[11px] text-muted-foreground shrink-0">
                                  {list.length} {list.length === 1 ? "match" : "matches"}
                                  {datesInRound.length > 1 ? ` · ${datesInRound.length} days` : ""}
                                </span>
                              </div>
                              {!isFinalsRound && (
                                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <CalendarDays className="h-3 w-3" />
                                  <span>Move to:</span>
                                  <input
                                    type="date"
                                    value={overrideValue}
                                    onChange={(e) => setRoundDate(round, e.target.value)}
                                    className="h-7 px-1.5 py-0.5 text-xs bg-background border border-input rounded"
                                  />
                                </label>
                              )}
                            </div>
                            <ul className="divide-y">
                              {list.map((p, i) => {
                                const timeLabel = p.scheduledAt
                                  ? format(p.scheduledAt, "EEE d MMM · HH:mm")
                                  : "(unscheduled)";
                                const homeName = p.homeLabel ?? (p.home ? (nameById.get(p.home) ?? "?") : "TBD");
                                const awayName = p.awayLabel ?? (p.away ? (nameById.get(p.away) ?? "?") : "TBD");
                                return (
                                  <li key={i} className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <span className="flex-1 min-w-0 text-sm font-medium text-right truncate">{homeName}</span>
                                      <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">vs</span>
                                      <span className="flex-1 min-w-0 text-sm font-medium text-left truncate">{awayName}</span>
                                    </div>
                                    {p.note && (
                                      <div className="mt-0.5 text-center text-[11px] font-medium text-primary">
                                        {p.note}
                                      </div>
                                    )}
                                    <div className="mt-1 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
                                      <span>{timeLabel}</span>
                                      {p.pitch && <span>· Pitch {p.pitch}</span>}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            {byeTeams.length > 0 && (
                              <div className="px-3 py-1.5 text-[11px] text-muted-foreground italic border-t bg-muted/30">
                                Bye: {byeTeams.map((t: any) => t.name).join(", ")}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
                      <Button onClick={saveFixtures} disabled={generating || allPlaced.length === 0} className="w-full sm:w-auto min-h-11">
                        {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                        Save fixtures
                      </Button>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
                        <Button variant="outline" onClick={onShuffle} disabled={generating} className="min-h-11">
                          <Shuffle className="h-4 w-4 mr-1" /> Shuffle
                        </Button>
                        <Button variant="outline" onClick={onRegenerate} disabled={generating} className="min-h-11">
                          <RefreshCw className="h-4 w-4 mr-1" /> Regenerate
                        </Button>
                      </div>
                      <Button variant="ghost" onClick={() => { setPreviewPairings(null); setRoundDateOverrides(new Map()); }} disabled={generating} className="w-full sm:w-auto min-h-11 sm:ml-auto">
                        Back
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <FixturesFilterAndList
        matches={matches as any[]}
        divisions={divisions}
        entries={entries}
        isAdmin={isAdmin}
        competitionId={competitionId}
        source={source}
      />
    </div>
  );
}


function FixturesFilterAndList({
  matches,
  divisions,
  entries,
  isAdmin,
  competitionId,
  source,
}: {
  matches: any[];
  divisions: any[];
  entries: any[];
  isAdmin: boolean;
  competitionId: string;
  source?: string;
}) {
  const [filterDivisionId, setFilterDivisionId] = useState<string>("_all");
  const [filterTeamId, setFilterTeamId] = useState<string>("_all");
  const [filterClubId, setFilterClubId] = useState<string>("_all");
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);

  // For PlayHQ comps, fetch any Ignite teams that link to PlayHQ team ids
  // appearing in this comp's matches — this gives us a real club_id per
  // external team so we can offer a Club filter alongside the Team filter.
  const externalTeamIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of matches) {
      if (m.external_home_team_id) s.add(m.external_home_team_id);
      if (m.external_away_team_id) s.add(m.external_away_team_id);
    }
    return Array.from(s);
  }, [matches]);

  const { data: linkedTeams = [] } = useQuery({
    queryKey: ["competition-linked-teams", competitionId, externalTeamIds.length],
    enabled: externalTeamIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, playhq_team_id, club_id, clubs:club_id(id, name)")
        .in("playhq_team_id", externalTeamIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map external (PlayHQ) team id → { clubId, clubName }
  const clubByExternalTeam = useMemo(() => {
    const m = new Map<string, { clubId: string; clubName: string }>();
    for (const t of linkedTeams as any[]) {
      if (t.playhq_team_id && t.clubs?.id) {
        m.set(t.playhq_team_id, { clubId: t.clubs.id, clubName: t.clubs.name });
      }
    }
    return m;
  }, [linkedTeams]);

  // Build the team option list. Each entry is { id, name } where id is either
  // an Ignite team id or `ext:<external_team_id>` for unlinked PlayHQ teams.
  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of matches) {
      if (filterDivisionId !== "_all" && m.division_id !== filterDivisionId) continue;
      if (m.home?.id) seen.set(m.home.id, m.home.name);
      else if (m.external_home_team_id) seen.set(`ext:${m.external_home_team_id}`, m.home_team_name ?? "Unknown team");
      if (m.away?.id) seen.set(m.away.id, m.away.name);
      else if (m.external_away_team_id) seen.set(`ext:${m.external_away_team_id}`, m.away_team_name ?? "Unknown team");
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matches, filterDivisionId]);

  const clubOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of matches) {
      if (filterDivisionId !== "_all" && m.division_id !== filterDivisionId) continue;
      if (m.external_home_team_id) {
        const c = clubByExternalTeam.get(m.external_home_team_id);
        if (c) seen.set(c.clubId, c.clubName);
      }
      if (m.external_away_team_id) {
        const c = clubByExternalTeam.get(m.external_away_team_id);
        if (c) seen.set(c.clubId, c.clubName);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matches, filterDivisionId, clubByExternalTeam]);

  const filteredMatches = useMemo(() => {
    return matches.filter((m: any) => {
      if (filterDivisionId !== "_all" && m.division_id !== filterDivisionId) return false;
      if (filterTeamId !== "_all") {
        if (filterTeamId.startsWith("ext:")) {
          const ext = filterTeamId.slice(4);
          if (m.external_home_team_id !== ext && m.external_away_team_id !== ext) return false;
        } else if (m.home_team_id !== filterTeamId && m.away_team_id !== filterTeamId) {
          return false;
        }
      }
      if (filterClubId !== "_all") {
        const homeClub = m.external_home_team_id ? clubByExternalTeam.get(m.external_home_team_id)?.clubId : null;
        const awayClub = m.external_away_team_id ? clubByExternalTeam.get(m.external_away_team_id)?.clubId : null;
        if (homeClub !== filterClubId && awayClub !== filterClubId) return false;
      }
      return true;
    });
  }, [matches, filterDivisionId, filterTeamId, filterClubId, clubByExternalTeam]);

  // Reset team filter if not in current division scope
  useEffect(() => {
    if (filterTeamId !== "_all" && !teamOptions.some((t) => t.id === filterTeamId)) {
      setFilterTeamId("_all");
    }
  }, [filterTeamId, teamOptions]);
  useEffect(() => {
    if (filterClubId !== "_all" && !clubOptions.some((c) => c.id === filterClubId)) {
      setFilterClubId("_all");
    }
  }, [filterClubId, clubOptions]);

  const showDivisionFilter = divisions.length > 1;
  const showTeamFilter = teamOptions.length > 1;
  const showClubFilter = clubOptions.length > 1;
  const divisionLabel = source === "playhq" ? "Grade" : "Division";


  if (matches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <CalendarPlus className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold">No fixtures yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {isAdmin
              ? "Invite teams first, then generate a round-robin fixture or add matches manually."
              : "Fixtures will appear here once the organiser adds them."}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group matches by round_number, preserving order
  const groups: { key: string; label: string; items: any[] }[] = [];
  const indexByKey = new Map<string, number>();
  for (const m of filteredMatches) {
    const key = m.round_number != null ? `r${m.round_number}` : "unscheduled";
    const label = m.round_number != null ? `Round ${m.round_number}` : "Other matches";
    let idx = indexByKey.get(key);
    if (idx == null) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label, items: [] });
    }
    groups[idx].items.push(m);
  }

  return (
    <>
      {(showDivisionFilter || showTeamFilter) && (
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur-0 border-b border-border/40 flex flex-wrap gap-2">
          {showDivisionFilter && (
            <Select value={filterDivisionId} onValueChange={setFilterDivisionId}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder={`All ${divisionLabel.toLowerCase()}s`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All {divisionLabel.toLowerCase()}s</SelectItem>
                {divisions.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showTeamFilter && (
            <>
              <button
                type="button"
                onClick={() => setTeamSheetOpen(true)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterTeamId === "_all"
                  ? "All teams"
                  : teamOptions.find((t) => t.id === filterTeamId)?.name ?? "All teams"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
                <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by team</SheetTitle>
                    <SheetDescription className="sr-only">
                      Choose a team to filter the fixture list.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterTeamId("_all");
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {filterTeamId === "_all" && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setFilterTeamId(t.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{t.name}</span>
                          {filterTeamId === t.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
          {showClubFilter && (
            <Select value={filterClubId} onValueChange={setFilterClubId}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder="All clubs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All clubs</SelectItem>
                {clubOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {filteredMatches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No fixtures match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(() => {
            const roundNums = Array.from(
              new Set(
                filteredMatches
                  .map((m) => m.round_number)
                  .filter((n: any) => n != null)
              )
            ) as number[];
            const totalRounds = roundNums.length;
            const maxRound = roundNums.length > 0 ? Math.max(...roundNums) : 0;
            if (totalRounds === 0) return null;
            return (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <span className="font-medium text-foreground">
                  {totalRounds} round{totalRounds === 1 ? "" : "s"} scheduled
                  <span className="text-muted-foreground font-normal ml-2 tabular-nums">(max: {maxRound})</span>
                </span>
                {isAdmin && source !== "playhq" && (
                  <SetMaxRoundsButton
                    competitionId={competitionId}
                    currentMax={maxRound}
                    roundNums={roundNums}
                  />
                )}
              </div>
            );
          })()}
          {groups.map((g) => (
            <RoundSection
              key={g.key}
              label={g.label}
              items={g.items}
              isAdmin={isAdmin}
              competitionId={competitionId}
              entries={entries}
              divisions={divisions}
              source={source}
            />
          ))}
        </div>
      )}
    </>
  );
}



function SetMaxRoundsButton({
  competitionId,
  currentMax,
  roundNums,
}: {
  competitionId: string;
  currentMax: number;
  roundNums: number[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(String(currentMax));
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setValue(String(currentMax)); }, [open, currentMax]);

  const target = Math.max(1, Number(value) || 0);
  const willDelete = roundNums.filter((n) => n > target).sort((a, b) => a - b);
  const willAdd = target > currentMax ? target - currentMax : 0;

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      if (willDelete.length > 0) {
        const { error } = await supabase
          .from("competition_matches")
          .delete()
          .eq("competition_id", competitionId)
          .gt("round_number", target);
        if (error) throw error;
        toast({ title: `Trimmed to ${target} round${target === 1 ? "" : "s"}` });
      } else if (willAdd > 0) {
        toast({
          title: "Use Generate or Add match",
          description: `To add ${willAdd} more round${willAdd === 1 ? "" : "s"}, regenerate the fixture or add matches manually.`,
        });
      } else {
        toast({ title: "No changes" });
      }
      qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't update", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
        Set max
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Set max number of rounds</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Current max is round {currentMax}. Lowering this will delete any matches in rounds beyond the new max.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Max rounds</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {willDelete.length > 0 && (
              <p className="text-xs text-destructive">
                Will delete round{willDelete.length === 1 ? "" : "s"} {willDelete.join(", ")} and all matches in {willDelete.length === 1 ? "it" : "them"}.
              </p>
            )}
            {willAdd > 0 && (
              <p className="text-xs text-muted-foreground">
                To add more rounds, use Generate round-robin or Add match.
              </p>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={saving || willDelete.length === 0}
              variant={willDelete.length > 0 ? "destructive" : "default"}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {willDelete.length > 0 ? `Trim to ${target} rounds` : "Save"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function RoundSection({
  label,
  items,
  isAdmin,
  competitionId,
  entries,
  divisions,
  source,
}: {
  label: string;
  items: any[];
  isAdmin: boolean;
  competitionId: string;
  entries: any[];
  divisions: any[];
  source?: string;
}) {
  const [open, setOpen] = useState(true);

  // Derive a date summary for the round header
  const dateRange = useMemo(() => {
    const dates = items
      .map((m) => (m.scheduled_at ? new Date(m.scheduled_at) : null))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length === 0) return null;
    const first = format(dates[0], "EEE d MMM");
    const last = format(dates[dates.length - 1], "EEE d MMM");
    return first === last ? first : `${first} – ${last}`;
  }, [items]);

  const completed = items.filter((m) => m.status === "completed").length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger className="w-full group sticky top-0 z-10 bg-background -mx-1 px-1 py-2 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0 text-left">
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-extrabold tracking-wider text-foreground uppercase leading-tight">{label}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums leading-tight mt-0.5">
              {items.length} {items.length === 1 ? "Match" : "Matches"}{dateRange ? ` • ${dateRange}` : ""}
            </div>
          </div>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium tabular-nums ${completed === items.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {completed}/{items.length} {completed === items.length ? "Complete" : "Complete"}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5">
        {items.map((m: any) => (
          <MatchRow key={m.id} match={m} isAdmin={isAdmin} competitionId={competitionId} entries={entries} divisions={divisions} source={source} hideRoundBadge />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}




function MatchRow({ match, isAdmin, competitionId, entries, divisions, hideRoundBadge = false, source }: { match: any; isAdmin: boolean; competitionId: string; entries: any[]; divisions: any[]; hideRoundBadge?: boolean; source?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? "");
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? "");
  const [status, setStatus] = useState<string>(match.status);
  const [manageOpen, setManageOpen] = useState(false);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    tapStartRef.current = null;
  };

  const save = async () => {
    const homeN = home === "" ? null : Number(home);
    const awayN = away === "" ? null : Number(away);
    // Auto-mark as completed when both scores are entered (unless it's already
    // in a non-scheduled state like cancelled/postponed, which we preserve).
    let nextStatus = status;
    const bothScores = homeN != null && awayN != null;
    if (bothScores && (status === "scheduled" || status === "in_progress")) {
      nextStatus = "completed";
    } else if (!bothScores && status === "completed") {
      // Clearing scores reverts an auto-completed match back to scheduled.
      nextStatus = "scheduled";
    }
    // PlayHQ-sourced rows are sync-locked. The first local edit stamps
    // manually_overridden_at, which the DB trigger uses to release the row
    // from future sync overwrites.
    const isExternal = match.source && match.source !== "manual";
    const payload: Record<string, unknown> = { home_score: homeN, away_score: awayN, status: nextStatus };
    if (isExternal && !match.manually_overridden_at) {
      payload.manually_overridden_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("competition_matches")
      .update(payload as never)
      .eq("id", match.id);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    setStatus(nextStatus);
    toast({
      title: "Match updated",
      description: isExternal && !match.manually_overridden_at
        ? "This match is now locally overridden — future PlayHQ syncs won't change it."
        : undefined,
    });
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };


  const remove = async () => {
    if (!window.confirm("Delete this match?")) return;
    const { error } = await supabase.from("competition_matches").delete().eq("id", match.id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  const statusLabel = (match.status ?? "scheduled").replace("_", " ");
  const hasScore = match.home_score != null || match.away_score != null;
  const venueName = match.venue ? String(match.venue).split(",")[0].trim() : null;
  const venueLine = venueName
    ? `${venueName}${match.pitch_number ? ` · Pitch ${match.pitch_number}` : ""}`
    : null;

  const scheduledDate = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const isCompleted = match.status === "completed";
  const isCancelled = match.status === "cancelled";
  const isPostponed = match.status === "postponed";
  const isInProgress = match.status === "in_progress";

  // Color-coded status pill
  const statusPillClass =
    isCompleted ? "bg-muted text-muted-foreground"
    : isCancelled ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
    : isPostponed ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : isInProgress ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse"
    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";

  const homeName = match.home?.name ?? "TBD";
  const awayName = match.away?.name ?? "TBD";
  const homeInitials = homeName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const awayInitials = awayName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const homeWon = hasScore && match.home_score != null && match.away_score != null && match.home_score > match.away_score;
  const awayWon = hasScore && match.home_score != null && match.away_score != null && match.away_score > match.home_score;


  const isScheduled = !isCompleted && !isCancelled && !isPostponed && !isInProgress;
  return (
    <Card className={`overflow-hidden w-full box-border shadow-sm hover:shadow-md transition-shadow ${isCancelled ? "opacity-60" : ""}`}>
      <CardContent className="px-4 pt-4 pb-3.5 space-y-4">
        {/* 1. Time — compact metadata row */}
        {!editing && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-semibold text-foreground tabular-nums leading-snug">
              {scheduledDate ? format(scheduledDate, "h:mm a") : "Time TBD"}
            </span>
            <span className="text-sm text-muted-foreground leading-snug">
              {scheduledDate ? format(scheduledDate, "EEE d MMM") : "Date TBD"}
            </span>
            <div className="flex-1 min-w-0" />
            {match.source && match.source !== "manual" && (
              <span
                className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400"
                title={match.manually_overridden_at
                  ? `Synced from ${match.source} · locally overridden`
                  : `Synced from ${match.source}`}
              >
                {match.manually_overridden_at ? `${match.source} · local` : match.source}
              </span>
            )}
            {!isScheduled && (
              <span className={`shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider ${statusPillClass}`}>
                {statusLabel}
              </span>
            )}
          </div>
        )}

        {/* 2. Teams — primary visual focus */}
        {editing ? (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Home</div>
                <div className="text-sm font-bold break-words">{homeName}</div>
                <Input type="number" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} className="h-9 text-center text-lg font-bold tabular-nums" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-5">vs</span>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Away</div>
                <div className="text-sm font-bold break-words text-right">{awayName}</div>
                <Input type="number" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} className="h-9 text-center text-lg font-bold tabular-nums" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Entering both scores marks this match as completed. Use the settings menu → Edit details to change status (e.g. postponed, cancelled).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="h-9 w-full" onClick={save}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-9 w-full" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            {/* Home */}
            <div className="flex items-center gap-2 min-w-0">
              <TeamAvatar name={homeName} logoUrl={match.home?.logo_url} initials={homeInitials} size={24} />
              <div
                className={`flex-1 min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.01em] truncate ${awayWon ? "text-muted-foreground" : "text-foreground"}`}
                title={homeName}
              >
                {homeName}
              </div>
            </div>

            {/* Score / vs */}
            <div className="flex flex-col items-center justify-center px-1 shrink-0">
              {hasScore ? (
                <div className="flex items-center gap-1 text-xl font-bold tabular-nums leading-none">
                  <span className={homeWon ? "" : awayWon ? "text-muted-foreground" : ""}>{match.home_score ?? "–"}</span>
                  <span className="text-muted-foreground text-sm">-</span>
                  <span className={awayWon ? "" : homeWon ? "text-muted-foreground" : ""}>{match.away_score ?? "–"}</span>
                </div>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">vs</span>
              )}
            </div>

            {/* Away — mirrored: avatar on outside, name flush to centre */}
            <div className="flex flex-row-reverse items-center gap-2 min-w-0">
              <TeamAvatar name={awayName} logoUrl={match.away?.logo_url} initials={awayInitials} size={24} />
              <div
                className={`flex-1 min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.01em] truncate text-right ${homeWon ? "text-muted-foreground" : "text-foreground"}`}
                title={awayName}
              >
                {awayName}
              </div>
            </div>
          </div>
        )}

        {/* 3. Admin actions moved above; venue rendered below as bottom metadata */}


        {/* 4. Admin actions — compact, flush to bottom */}
        {isAdmin && !editing && source !== "playhq" && (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant={hasScore ? "ghost" : "outline"}
              className={
                hasScore
                  ? "h-9 flex-1 px-3 text-sm text-muted-foreground hover:text-foreground"
                  : "h-9 flex-1 px-3 text-sm font-semibold text-primary border-primary/40 hover:bg-primary/5"
              }
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4 mr-1.5" />
              {hasScore ? "Edit score" : "Enter score"}
            </Button>
            <DropdownMenu open={manageOpen} onOpenChange={setManageOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Fixture settings"
                  className="h-9 w-9 p-0 text-muted-foreground select-none touch-manipulation shrink-0"

                  onPointerDown={(e) => {
                    tapStartRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onPointerUp={(e) => {
                    const start = tapStartRef.current;
                    tapStartRef.current = null;
                    if (!start) return;
                    const dx = e.clientX - start.x;
                    const dy = e.clientY - start.y;
                    if (Math.sqrt(dx * dx + dy * dy) > 10) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onPointerCancel={() => { tapStartRef.current = null; }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setEditDetailsOpen(true)}>
                  <Settings2 className="h-4 w-4 mr-2" /> Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4 mr-2" /> Edit score
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* 4. Venue + Pitch — bottom metadata, subtle */}
        {!editing && (venueLine || match.pitch_number) && (
          <div className="flex items-center gap-1.5 pt-3 text-sm text-muted-foreground leading-relaxed border-t border-border/40">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{venueLine || `Pitch ${match.pitch_number}`}</span>
          </div>
        )}
      </CardContent>


      {isAdmin && editDetailsOpen && (
        <EditMatchDetailsDialog
          open={editDetailsOpen}
          onOpenChange={setEditDetailsOpen}
          match={match}
          competitionId={competitionId}
          entries={entries}
          divisions={divisions}
        />
      )}
    </Card>
  );
}

function EditMatchDetailsDialog({
  open,
  onOpenChange,
  match,
  competitionId,
  entries,
  divisions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  match: any;
  competitionId: string;
  entries: any[];
  divisions: any[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const accepted = entries.filter((e: any) => e.status === "accepted");

  const initialDate = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const initialDateStr = initialDate ? format(initialDate, "yyyy-MM-dd") : "";
  const initialTimeStr = initialDate ? format(initialDate, "HH:mm") : "";

  const [homeId, setHomeId] = useState<string>(match.home_team_id ?? "");
  const [awayId, setAwayId] = useState<string>(match.away_team_id ?? "");
  const [divisionId, setDivisionId] = useState<string>(match.division_id ?? "");
  const [dateStr, setDateStr] = useState<string>(initialDateStr);
  const [timeStr, setTimeStr] = useState<string>(initialTimeStr || "09:00");
  const [venue, setVenue] = useState<string>(match.venue ?? "");
  const [pitch, setPitch] = useState<string>(match.pitch_number ?? "");
  const [round, setRound] = useState<string>(match.round_number != null ? String(match.round_number) : "");
  const [duration, setDuration] = useState<string>(match.duration_minutes != null ? String(match.duration_minutes) : "");
  const [arrival, setArrival] = useState<string>(match.arrival_minutes_before != null ? String(match.arrival_minutes_before) : "");
  const [notes, setNotes] = useState<string>(match.notes ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!homeId || !awayId || homeId === awayId) {
      toast({ title: "Pick two different teams", variant: "destructive" });
      return;
    }
    if (!venue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    let scheduledAt: string | null = match.scheduled_at ?? null;
    if (dateStr) {
      const iso = new Date(`${dateStr}T${timeStr || "09:00"}:00`).toISOString();
      scheduledAt = iso;
    }
    setSaving(true);
    const { error } = await supabase
      .from("competition_matches")
      .update({
        home_team_id: homeId,
        away_team_id: awayId,
        division_id: divisionId || null,
        scheduled_at: scheduledAt,
        venue: venue,
        pitch_number: pitch.trim() || null,
        round_number: round ? Number(round) : null,
        duration_minutes: duration ? Number(duration) : null,
        arrival_minutes_before: arrival ? Number(arrival) : null,
        notes: notes || null,
      })
      .eq("id", match.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not update match", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match updated" });
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit match details</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Updates flow through to the linked team events.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Home team</Label>
              <Select value={homeId} onValueChange={setHomeId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {accepted.map((e: any) => (
                    <SelectItem key={e.team_id} value={e.team_id}>{e.teams?.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Away team</Label>
              <Select value={awayId} onValueChange={setAwayId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {accepted.map((e: any) => (
                    <SelectItem key={e.team_id} value={e.team_id}>{e.teams?.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {divisions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Division (optional)</Label>
              <Select value={divisionId || "_none"} onValueChange={(v) => setDivisionId(v === "_none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {divisions.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Round</Label>
              <Input type="number" inputMode="numeric" min={1} value={round} onChange={(e) => setRound(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Venue</Label>
              <AddressAutocomplete
                value={venue}
                onChange={setVenue}
                onSelect={(a) => {
                  const full = [a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", ");
                  setVenue(full);
                }}
                placeholder="Search venue or address…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pitch / Court #</Label>
              <Input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="e.g. 3" />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (mins)</Label>
              <Input type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Arrive (mins before)</Label>
              <Input type="number" inputMode="numeric" min={0} value={arrival} onChange={(e) => setArrival(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the team event" />
            </div>
          </div>
        </div>

        <ResponsiveDialogFooter className="flex-row gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="flex-1 min-h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="flex-1 min-h-11">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function AddFinalsRoundMenuItem({ competitionId, divisions }: { competitionId: string; divisions: any[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [divisionId, setDivisionId] = useState<string>("");
  const [format, setFormat] = useState<FinalsFormat>("gf");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("09:00");
  const [duration, setDuration] = useState<string>("60");
  const [venue, setVenue] = useState<string>("");
  const [pitchInput, setPitchInput] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setDivisionId(""); setFormat("gf"); setDate(""); setTime("09:00");
    setDuration("60"); setVenue(""); setPitchInput("");
  };

  const submit = async () => {
    if (!date) {
      toast({ title: "Pick a finals date", variant: "destructive" });
      return;
    }
    if (!venue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    // Compute next round number for this competition + division scope
    let q = supabase
      .from("competition_matches")
      .select("round_number")
      .eq("competition_id", competitionId)
      .order("round_number", { ascending: false, nullsFirst: false })
      .limit(1);
    if (divisionId) q = q.eq("division_id", divisionId);
    else q = q.is("division_id", null);
    const { data: existing, error: existingError } = await q;
    if (existingError) {
      setSaving(false);
      toast({
        title: "Couldn't add finals",
        description: "We couldn't work out the next round number. Please try again.",
        variant: "destructive",
      });
      return;
    }
    const nextRound = (existing?.[0]?.round_number ?? 0) + 1;


    const pairs = buildFinalsSeedPairings(format);
    const pitchLabels = pitchInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const usePitches = pitchLabels.length > 0 ? pitchLabels : Array.from({ length: pairs.length }, (_, i) => String(i + 1));
    const dur = Math.max(1, Number(duration) || 60);
    const [hh, mm] = time.split(":").map(Number);
    const baseStart = new Date(`${date}T00:00:00`);
    baseStart.setHours(hh || 9, mm || 0, 0, 0);

    const rows = pairs.map((p, idx) => {
      // Spread across pitches; if more pairs than pitches, stagger by duration
      const wave = Math.floor(idx / usePitches.length);
      const pitch = usePitches[idx % usePitches.length];
      const start = new Date(baseStart.getTime() + wave * dur * 60_000);
      return {
        competition_id: competitionId,
        division_id: divisionId || null,
        round_number: nextRound,
        home_team_id: null,
        away_team_id: null,
        status: "scheduled" as const,
        created_by: user?.id ?? null,
        scheduled_at: start.toISOString(),
        venue,
        pitch_number: pitch,
        duration_minutes: dur,
        notes: p.isGrandFinal
          ? `Grand Final · ${p.homeSeed} v ${p.awaySeed}`
          : `Finals · ${p.homeSeed} v ${p.awaySeed}`,
      };
    });

    const { error } = await supabase.from("competition_matches").insert(rows);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't add finals", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Added finals round (${rows.length} match${rows.length === 1 ? "" : "es"})` });
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    reset();
    setOpen(false);
  };

  return (
    <>
      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
        <Trophy className="h-4 w-4 mr-2" /> Add finals round
      </DropdownMenuItem>
      <ResponsiveDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Add finals round</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Schedules placeholder finals matches. Teams are TBD and locked in once standings are known.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            {divisions.length > 0 && (
              <div>
                <Label>Division (optional)</Label>
                <select
                  value={divisionId || "_all"}
                  onChange={(e) => setDivisionId(e.target.value === "_all" ? "" : e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="_all">No division</option>
                  {divisions.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label>Finals format</Label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as FinalsFormat)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="gf">Grand Final only (1 v 2)</option>
                <option value="top4">Top 4 (1v2, 3v4)</option>
                <option value="top6">Top 6 (1v2, 3v4, 5v6)</option>
                <option value="top8">Top 8 (1v2, 3v4, 5v6, 7v8)</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {buildFinalsSeedPairings(format).length} match{buildFinalsSeedPairings(format).length === 1 ? "" : "es"} will be created.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>First kickoff</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <Label>Duration (mins)</Label>
                <Input type="number" inputMode="numeric" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
              <div>
                <Label>Pitches (optional)</Label>
                <Input value={pitchInput} onChange={(e) => setPitchInput(e.target.value)} placeholder="e.g. 1, 2" />
              </div>
            </div>
            <div>
              <Label>Venue <span className="text-destructive">*</span></Label>
              <AddressAutocomplete
                value={venue}
                onChange={setVenue}
                onSelect={(a) => {
                  const full = [a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", ");
                  setVenue(full);
                }}
                placeholder="Search venue or address…"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trophy className="h-4 w-4 mr-1" />}
              Add finals
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}


function AddMatchMenuItem(props: { competitionId: string; entries: any[]; divisions: any[] }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSheetOpen(true); }}>
        <Plus className="h-4 w-4 mr-2" /> Add match
      </DropdownMenuItem>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-3xl px-5 pb-8">
          <SheetHeader className="mb-5">
            <SheetTitle className="text-xl font-bold">Add match</SheetTitle>
            <SheetDescription>
              Select two different teams and enter the fixture details.
            </SheetDescription>
          </SheetHeader>
          <AddMatchButton {...props} defaultOpen onSaved={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function AddMatchButton({ competitionId, entries, divisions, defaultOpen = false, onSaved }: { competitionId: string; entries: any[]; divisions: any[]; defaultOpen?: boolean; onSaved?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [homeId, setHomeId] = useState("");
  const [awayId, setAwayId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [venue, setVenue] = useState("");
  const [pitch, setPitch] = useState("");
  const [round, setRound] = useState("");
  const [duration, setDuration] = useState("");
  const [arrival, setArrival] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const accepted = entries.filter((e: any) => e.status === "accepted");

  const reset = () => {
    setHomeId(""); setAwayId(""); setDivisionId(""); setScheduledAt("");
    setVenue(""); setPitch(""); setRound(""); setDuration(""); setArrival(""); setNotes("");
  };

  const submit = async () => {
    if (!homeId || !awayId || homeId === awayId) {
      toast({ title: "Pick two different teams", variant: "destructive" });
      return;
    }
    if (!scheduledAt) {
      toast({ title: "Start date & time required", variant: "destructive" });
      return;
    }
    if (!venue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("competition_matches").insert({
      competition_id: competitionId,
      home_team_id: homeId,
      away_team_id: awayId,
      division_id: divisionId || null,
      scheduled_at: new Date(scheduledAt).toISOString(),
      venue: venue,
      pitch_number: pitch.trim() || null,
      round_number: round ? Number(round) : null,
      duration_minutes: duration ? Number(duration) : null,
      arrival_minutes_before: arrival ? Number(arrival) : null,
      notes: notes || null,
      status: "scheduled",
      created_by: user?.id ?? null,
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Could not add match", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match added" });
    setOpen(false); reset();
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    onSaved?.();
  };

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add match</Button>;
  }
  // Shared input class so every field looks like the matchmaker direction.
  const fieldClass =
    "h-11 bg-muted/40 border border-border/60 rounded-xl text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary transition-all";
  const labelClass =
    "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 ml-0.5";

  return (
    <div className="w-full space-y-7">
      {/* Teams matchup — hero row with VS divider */}
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className={labelClass}>Home team</label>
          <Select value={homeId} onValueChange={setHomeId}>
            <SelectTrigger className={fieldClass}><SelectValue placeholder="Select team" /></SelectTrigger>
            <SelectContent>
              {accepted.map((e: any) => (
                <SelectItem key={e.team_id} value={e.team_id}>{e.teams?.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="pb-3 shrink-0">
          <span className="text-[11px] font-black tracking-wider text-muted-foreground/60">VS</span>
        </div>
        <div className="flex-1 min-w-0">
          <label className={labelClass}>Away team</label>
          <Select value={awayId} onValueChange={setAwayId}>
            <SelectTrigger className={fieldClass}><SelectValue placeholder="Select team" /></SelectTrigger>
            <SelectContent>
              {accepted.map((e: any) => (
                <SelectItem key={e.team_id} value={e.team_id}>{e.teams?.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {divisions.length > 0 && (
        <div>
          <label className={labelClass}>Division <span className="lowercase font-normal text-muted-foreground/60">(optional)</span></label>
          <Select value={divisionId || "_none"} onValueChange={(v) => setDivisionId(v === "_none" ? "" : v)}>
            <SelectTrigger className={fieldClass}><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">None</SelectItem>
              {divisions.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Schedule */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Start date <span className="text-destructive">*</span></label>
            <Input
              type="date"
              required
              className={fieldClass}
              value={scheduledAt ? scheduledAt.split("T")[0] : ""}
              onChange={(e) => {
                const time = scheduledAt.split("T")[1] || "09:00";
                setScheduledAt(e.target.value ? `${e.target.value}T${time}` : "");
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Start time <span className="text-destructive">*</span></label>
            <Input
              type="time"
              required
              className={fieldClass}
              value={scheduledAt ? (scheduledAt.split("T")[1] || "") : ""}
              onChange={(e) => {
                const date = scheduledAt.split("T")[0];
                if (date) setScheduledAt(`${date}T${e.target.value}`);
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Duration <span className="lowercase font-normal text-muted-foreground/60">(mins)</span></label>
            <Input type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 90" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Arrive before</label>
            <Input type="number" inputMode="numeric" min={0} value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="e.g. 30" className={fieldClass} />
          </div>
        </div>
      </div>

      {/* Venue + Pitch */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className={labelClass}>Venue <span className="text-destructive">*</span></label>
          <AddressAutocomplete
            value={venue}
            onChange={setVenue}
            onSelect={(a) => {
              const full = [a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", ");
              setVenue(full);
            }}
            placeholder="Search venue or address…"
          />
        </div>
        <div>
          <label className={labelClass}>Pitch #</label>
          <Input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="e.g. 3" className={fieldClass} />
        </div>
      </div>

      {/* Additional details */}
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Round <span className="lowercase font-normal text-muted-foreground/60">(optional)</span></label>
          <Input type="number" inputMode="numeric" min={1} value={round} onChange={(e) => setRound(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Notes <span className="lowercase font-normal text-muted-foreground/60">(optional)</span></label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the team event" className={fieldClass} />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
        A team event is created for both sides so players can RSVP.
      </p>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          onClick={submit}
          disabled={saving}
          className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/10 active:scale-[0.98] transition-transform"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save match"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => { setOpen(false); reset(); }}
          className="w-full h-11 text-muted-foreground font-medium hover:text-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}


export function CompetitionLadderPanel({ competitionId, divisions, isAdmin = false }: { competitionId: string; divisions: any[]; isAdmin?: boolean }) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["competition-ladder", competitionId],
    queryFn: async () => {
      const [ladderRes, entriesRes] = await Promise.all([
        supabase
          .from("competition_ladder")
          .select("*")
          .eq("competition_id", competitionId)
          .order("points", { ascending: false })
          .order("goal_diff", { ascending: false })
          .order("goals_for", { ascending: false }),
        supabase
          .from("competition_entries")
          .select("team_id, division_id, status, teams!inner(deleted_at)")
          .eq("competition_id", competitionId)
          .eq("status", "accepted")
          .is("teams.deleted_at", null),
      ]);
      if (ladderRes.error) throw ladderRes.error;
      if (entriesRes.error) throw entriesRes.error;
      const ladderData = ladderRes.data ?? [];
      const entriesData = entriesRes.data ?? [];

      // Build placeholder zero-rows for accepted entries without a ladder row yet
      const haveKey = new Set(
        ladderData.map((r: any) => `${r.team_id ?? ""}::${r.division_id ?? ""}`)
      );
      const placeholders: any[] = [];
      for (const e of entriesData) {
        const key = `${e.team_id ?? ""}::${e.division_id ?? ""}`;
        if (!e.team_id || haveKey.has(key)) continue;
        haveKey.add(key);
        placeholders.push({
          competition_id: competitionId,
          team_id: e.team_id,
          division_id: e.division_id,
          played: 0, wins: 0, draws: 0, losses: 0,
          goals_for: 0, goals_against: 0, goal_diff: 0, points: 0,
        });
      }
      const combined = [...ladderData, ...placeholders];

      const teamIds = Array.from(new Set(combined.map((r: any) => r.team_id).filter(Boolean)));
      if (teamIds.length === 0) return combined;

      const { data: teams, error: teamsError } = await supabase
        .from("teams")
        .select("id, name, logo_url")
        .in("id", teamIds);
      if (teamsError) throw teamsError;

      const teamById = new Map((teams ?? []).map((team: any) => [team.id, team]));
      return combined.map((row: any) => ({
        ...row,
        teams: teamById.get(row.team_id) ?? null,
      }));
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (isError) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 text-destructive mx-auto" />
          <h3 className="text-sm font-semibold">Couldn't load the ladder</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Something went wrong loading standings. Please check your connection and try again.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold">No ladder yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Once teams are accepted into divisions, standings will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <LadderView rows={rows} divisions={divisions} isAdmin={isAdmin} />;
}


function LadderView({ rows, divisions, isAdmin = false }: { rows: any[]; divisions: any[]; isAdmin?: boolean }) {
  const [filterDivisionId, setFilterDivisionId] = useState<string>("_all");
  const [filterTeamId, setFilterTeamId] = useState<string>("_all");
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);

  const hiddenDivisionIds = useMemo(
    () => new Set(divisions.filter((d: any) => d.hide_ladder).map((d: any) => d.id)),
    [divisions]
  );
  const hasHiddenDivisions = hiddenDivisionIds.size > 0;

  // Admins see all rows (with a "Hidden" badge on hidden divisions).
  // If any ladder is hidden, non-admins see no ladder at all.
  const visibleRows = useMemo(
    () => isAdmin
      ? rows
      : hasHiddenDivisions ? [] : rows,
    [rows, hasHiddenDivisions, isAdmin]
  );

  const presentDivisionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of visibleRows) if (r.division_id) ids.add(r.division_id);
    return ids;
  }, [visibleRows]);

  const divisionOptions = divisions.filter((d: any) => presentDivisionIds.has(d.id));
  const showDivisionFilter = divisionOptions.length > 1;

  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of visibleRows) {
      if (filterDivisionId !== "_all" && r.division_id !== filterDivisionId) continue;
      if (r.team_id) seen.set(r.team_id, r.teams?.name ?? "?");
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleRows, filterDivisionId]);

  useEffect(() => {
    if (filterTeamId !== "_all" && !teamOptions.some((t) => t.id === filterTeamId)) {
      setFilterTeamId("_all");
    }
  }, [filterTeamId, teamOptions]);
  const showTeamFilter = teamOptions.length > 1;

  // When a team is selected, show every ladder group that team participates in
  // (full standings, not just the selected team's row). Competitions without
  // divisions use the "Overall" ladder, where division_id is null.
  const teamDivisionKeys = useMemo(() => {
    if (filterTeamId === "_all") return null;
    const ids = new Set<string>();
    for (const r of visibleRows) {
      if (r.team_id === filterTeamId) ids.add(r.division_id ?? "__none");
    }
    return ids;
  }, [visibleRows, filterTeamId]);

  const filteredRows = visibleRows.filter((r: any) => {
    if (filterDivisionId !== "_all" && r.division_id !== filterDivisionId) return false;
    if (teamDivisionKeys && !teamDivisionKeys.has(r.division_id ?? "__none")) return false;
    return true;
  });

  const groups = new Map<string, any[]>();
  if (divisionOptions.length <= 1) {
    // Only one division — collapse Overall rows into the divisional ladder by team_id
    const overallRows = filteredRows.filter((r: any) => !r.division_id);
    const divRows = filteredRows.filter((r: any) => r.division_id);
    if (divRows.length) {
      const overallByTeam = new Map(overallRows.map((r: any) => [r.team_id, r]));
      const merged = divRows.map((r: any) => {
        const o = overallByTeam.get(r.team_id);
        if (!o) return r;
        // Prefer the row with actual played matches
        const hasDivData = (r.played ?? 0) > 0;
        const hasOverallData = (o.played ?? 0) > 0;
        if (hasOverallData && !hasDivData) {
          return { ...o, division_id: r.division_id, teams: r.teams ?? o.teams };
        }
        return r;
      });
      // Re-sort by points / goal_diff / goals_for
      merged.sort((a: any, b: any) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        (b.goal_diff ?? 0) - (a.goal_diff ?? 0) ||
        (b.goals_for ?? 0) - (a.goals_for ?? 0)
      );
      groups.set(divRows[0].division_id, merged);
    } else if (overallRows.length) {
      groups.set("__none", overallRows);
    }
  } else {
    filteredRows.forEach((r: any) => {
      const key = r.division_id ?? "__none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    });
  }

  return (
    <div className="space-y-4">
      {(showDivisionFilter || showTeamFilter) && (
        <div className="flex flex-wrap gap-2">
          {showDivisionFilter && (
            <Select value={filterDivisionId} onValueChange={setFilterDivisionId}>
              <SelectTrigger className="h-9 w-auto min-w-[140px]">
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All divisions</SelectItem>
                {divisionOptions.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showTeamFilter && (
            <>
              <button
                type="button"
                onClick={() => setTeamSheetOpen(true)}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterTeamId === "_all"
                  ? "All teams"
                  : teamOptions.find((t) => t.id === filterTeamId)?.name ?? "All teams"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
                <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by team</SheetTitle>
                    <SheetDescription className="sr-only">
                      Choose a team to filter the fixture list.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterTeamId("_all");
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {filterTeamId === "_all" && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setFilterTeamId(t.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{t.name}</span>
                          {filterTeamId === t.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      )}

      {groups.size === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No standings match the current filter.
          </CardContent>
        </Card>
      ) : (
        <TooltipProvider delayDuration={150}>
          {Array.from(groups.entries()).map(([divId, list]) => {
            const div = divisions.find((d: any) => d.id === divId);
            return (
              <LadderDivisionCard
                key={divId}
                title={div?.name ?? "Overall"}
                rows={list}
                isHidden={isAdmin && !!div?.hide_ladder}
              />
            );
          })}
        </TooltipProvider>
      )}
    </div>
  );
}

const COL_TOOLTIPS: Record<string, string> = {
  P: "Played",
  W: "Wins",
  D: "Draws",
  L: "Losses",
  "+/-": "Goal difference (for − against)",
  Pts: "Competition points",
};

function ColHead({ label, className }: { label: string; className?: string }) {
  return (
    <th className={cn("py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{COL_TOOLTIPS[label]}</TooltipContent>
      </Tooltip>
    </th>
  );
}

function LadderDivisionCard({ title, rows, isHidden = false }: { title: string; rows: any[]; isHidden?: boolean }) {
  const [open, setOpen] = useState(true);
  const teamCount = rows.length;
  const seasonStarted = rows.some((r) => (r.played ?? 0) > 0);

  return (
    <Card className="overflow-hidden">
      {/* Compact division header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border/60 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <Trophy className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        {isHidden && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
            Hidden
          </span>
        )}
        <span className="text-[11px] text-muted-foreground shrink-0">
          · {teamCount} {teamCount === 1 ? "team" : "teams"}
          {!seasonStarted && " · Not started"}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform ml-auto", !open && "-rotate-90")} />
      </button>


      {open && (
        <div>
          {!seasonStarted ? (
            <div className="px-4 py-8 text-center space-y-2">
              <Trophy className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                No results entered yet. Rankings will appear once matches are completed.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 bg-primary/5">
                <tr>
                  <th className="py-2 pl-3 pr-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left w-9">#</th>
                  <th className="py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left">Team</th>
                  <ColHead label="P" className="text-right" />
                  <ColHead label="W" className="text-right" />
                  <ColHead label="D" className="text-right" />
                  <ColHead label="L" className="text-right" />
                  <ColHead label="+/-" className="text-right pl-3" />
                  <ColHead label="Pts" className="text-right pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const rank = i + 1;
                  const gd = r.goal_diff ?? 0;
                  const medalColor =
                    rank === 1
                      ? "bg-amber-400/25 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/50"
                      : rank === 2
                      ? "bg-slate-400/25 text-slate-700 dark:text-slate-300 ring-1 ring-slate-400/50"
                      : rank === 3
                      ? "bg-orange-500/25 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/50"
                      : "bg-muted text-muted-foreground";
                  const topTint =
                    rank === 1 ? "bg-amber-400/[0.06]"
                    : rank === 2 ? "bg-slate-400/[0.06]"
                    : rank === 3 ? "bg-orange-500/[0.06]"
                    : i % 2 === 1 ? "bg-muted/20" : "";
                  const teamName = r.teams?.name ?? "?";
                  const initials = teamName
                    .split(/\s+/)
                    .map((s: string) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  const RowContent = (
                    <>
                      <td className={cn("py-3 pl-3 pr-1 align-middle", topTint)}>
                        <span
                          className={cn(
                            "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                            medalColor,
                          )}
                        >
                          {rank}
                        </span>
                      </td>
                      <td className={cn("py-3 px-1.5 align-middle min-w-0", topTint)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <TeamAvatar name={teamName} logoUrl={r.teams?.logo_url} initials={initials} size={28} />
                          <span className="font-semibold text-foreground truncate">{teamName}</span>
                        </div>
                      </td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.played ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.wins ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.draws ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.losses ?? 0}</td>
                      <td
                        className={cn(
                          "py-3 px-1.5 pl-3 text-right tabular-nums font-medium",
                          gd > 0 && "text-emerald-600 dark:text-emerald-400",
                          gd < 0 && "text-rose-600 dark:text-rose-400",
                          gd === 0 && "text-muted-foreground",
                          topTint,
                        )}
                      >
                        {gd > 0 ? `+${gd}` : gd}
                      </td>
                      <td className={cn("py-3 px-1.5 pr-3 text-right tabular-nums font-bold text-foreground", topTint)}>
                        {r.points ?? 0}
                      </td>
                    </>
                  );
                  return r.team_id ? (
                    <tr
                      key={r.team_id}
                      className="group cursor-pointer hover:bg-accent/40 active:bg-accent/60 transition-colors"
                      onClick={() => {
                        window.location.href = `/teams/${r.team_id}`;
                      }}
                    >
                      {RowContent}
                    </tr>
                  ) : (
                    <tr key={`row-${i}`}>{RowContent}</tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </Card>
  );
}




