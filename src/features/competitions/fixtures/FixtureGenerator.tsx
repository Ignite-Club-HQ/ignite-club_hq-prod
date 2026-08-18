import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  Shuffle,
} from "lucide-react";
import { format } from "date-fns";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildFinalsSeedPairings,
  buildRoundRobinPairings,
  dateKey,
  parseTimeToMins,
  placeFinalsFixtures,
  scheduleFixtures,
  type FinalsFormat,
  type Frequency,
  type OccupiedSlot,
  type PlacedFixture,
  type SchedulingMode,
} from "@/lib/competitionScheduler";
import { AddFinalsRoundMenuItem } from "./FinalsRoundForm";
import { AddMatchMenuItem } from "./ManualMatchForm";
import {
  buildGeneratedFixtureRows,
  describeGeneratedFixtureSaveError,
  persistGeneratedFixtures,
} from "./generationWorkflow";
import { competitionFixtureKeys } from "./queryKeys";
import { fetchCompetitionFixtures } from "./repository";
import type {
  CompetitionDivisionSummary,
  CompetitionEntrySummary,
  CompetitionFixtureRow,
  CompetitionTeamSummary,
} from "./types";

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

interface CompetitionFixtureGeneratorProps {
  competitionId: string;
  isAdmin: boolean;
  divisions: CompetitionDivisionSummary[];
  entries: CompetitionEntrySummary[];
  source?: string;
  renderFixtureList: (matches: CompetitionFixtureRow[]) => ReactNode;
}

export function CompetitionFixtureGenerator({ competitionId, isAdmin, divisions, entries, source, renderFixtureList }: CompetitionFixtureGeneratorProps) {
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
    queryKey: competitionFixtureKeys.matches(competitionId),
    queryFn: () => fetchCompetitionFixtures(competitionId),
  });

  const acceptedByDivision = (divisionId: string | null): CompetitionTeamSummary[] =>
    entries
      .filter((entry) => entry.status === "accepted" && (divisionId ? entry.division_id === divisionId : true))
      .map((entry) => entry.teams)
      .filter((team): team is CompetitionTeamSummary => Boolean(team));

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
    () => divisions.find((division) => division.id === genDivisionId) ?? null,
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
    for (const row of matches) {
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
      ? shuffleArray(teamsInScope.map((team) => team.id))
      : teamsInScope.map((team) => team.id);
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
    for (const team of teamsInScope) m.set(team.id, team.name);
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
    const rows = buildGeneratedFixtureRows({
      competitionId,
      divisionId: genDivisionId,
      startRound: genStartRound,
      createdBy: user?.id,
      venue: genVenue,
      durationMinutes: durationNum,
      arrivalMinutesBefore: genArrival,
      placedFixtures: allPlaced,
    });
    if (rows.length === 0) {
      setGenerating(false);
      toast({ title: "No fixtures fit the window", description: "Widen the time window, add weekdays, or push the end date.", variant: "destructive" });
      return;
    }
    const { error } = await persistGeneratedFixtures(rows, async (fixtures) => {
      const result = await supabase.from("competition_matches").insert(fixtures);
      return { error: result.error };
    });
    setGenerating(false);
    if (error) {
      toast({
        title: "Couldn't save fixtures",
        description: describeGeneratedFixtureSaveError(error),
        variant: "destructive",
      });
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
    qc.invalidateQueries({ queryKey: competitionFixtureKeys.matches(competitionId) });
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

  const totalAccepted = entries.filter((entry) => entry.status === "accepted").length;
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
                          {divisions.map((division) => (
                            <SelectItem key={division.id} value={division.id}>{division.name}</SelectItem>
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
                        const byeTeams = isFinalsRound ? [] : teamsInScope.filter((team) => !playingIds.has(team.id));
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
                                Bye: {byeTeams.map((team) => team.name).join(", ")}
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

      {renderFixtureList(matches)}
    </div>
  );
}
