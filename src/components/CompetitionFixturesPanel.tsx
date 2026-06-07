import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trophy, CalendarPlus, Save, X, AlertTriangle, ChevronDown, Shuffle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, addDays, addMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Frequency = "weekly" | "biweekly" | "triweekly" | "monthly" | "custom";
type SchedulingMode = "simultaneous" | "stagger";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function advanceByFrequency(d: Date, freq: Frequency, customDays: number): Date {
  switch (freq) {
    case "weekly": return addDays(d, 7);
    case "biweekly": return addDays(d, 14);
    case "triweekly": return addDays(d, 21);
    case "monthly": return addMonths(d, 1);
    case "custom": return addDays(d, Math.max(1, customDays));
  }
}

function nextOccurrenceOfWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  return addDays(d, diff);
}

interface Props {
  competitionId: string;
  isAdmin: boolean;
  divisions: any[];
  entries: any[]; // includes teams:team_id(id,name)
}

/** Round-robin fixture list for an even/odd team count using the circle method. */
function buildRoundRobin(teamIds: string[]): { round: number; home: string; away: string }[] {
  const teams = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) teams.push("__BYE__");
  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  const fixtures: { round: number; home: string; away: string }[] = [];
  let arr = [...teams];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        // alternate home/away each round
        if (r % 2 === 0) fixtures.push({ round: r + 1, home: a, away: b });
        else fixtures.push({ round: r + 1, home: b, away: a });
      }
    }
    // rotate (keep first fixed)
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return fixtures;
}

export function CompetitionFixturesPanel({ competitionId, isAdmin, divisions, entries }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [genOpen, setGenOpen] = useState(false);
  const [genDivisionId, setGenDivisionId] = useState<string>("");
  const [genFirstRoundDate, setGenFirstRoundDate] = useState<string>(""); // yyyy-mm-dd
  const [genKickoff, setGenKickoff] = useState<string>("09:00");
  const [genMatchDay, setGenMatchDay] = useState<number>(0); // 0=Sun
  const [matchDayManual, setMatchDayManual] = useState(false);
  const [genFrequency, setGenFrequency] = useState<Frequency>("weekly");
  const [genCustomDays, setGenCustomDays] = useState<string>("7");
  const [genEndDate, setGenEndDate] = useState<string>(""); // optional cutoff
  const [genStartRound, setGenStartRound] = useState<string>("1");
  const [genVenue, setGenVenue] = useState<string>("");
  const [genDuration, setGenDuration] = useState<string>("60");
  const [genArrival, setGenArrival] = useState<string>("");
  const [genAutoPitches, setGenAutoPitches] = useState<string>("");
  const [genMode, setGenMode] = useState<SchedulingMode>("simultaneous");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ round: number; home: string; away: string; homeName: string; awayName: string }[] | null>(null);

  const { data: matches = [], isLoading } = useQuery({
    queryKey: ["competition-matches", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_matches")
        .select("*, home:home_team_id(id, name), away:away_team_id(id, name), competition_divisions:division_id(name)")
        .eq("competition_id", competitionId)
        .order("round_number", { ascending: true, nullsFirst: false })
        .order("scheduled_at", { ascending: true, nullsFirst: false });
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
  const pitchCount = Math.max(0, Number(genAutoPitches) || 0);

  const summary = useMemo(() => {
    const n = teamsInScope.length;
    if (n < 2) return null;
    const fullRounds = n % 2 === 0 ? n - 1 : n;
    const matchesPerRound = Math.floor(n / 2);
    const firstDate = genFirstRoundDate
      ? nextOccurrenceOfWeekday(new Date(`${genFirstRoundDate}T${genKickoff || "09:00"}:00`), genMatchDay)
      : null;
    if (firstDate && genKickoff) {
      const [hh, mm] = genKickoff.split(":").map(Number);
      firstDate.setHours(hh || 9, mm || 0, 0, 0);
    }
    // If an end date is set, schedule every matching round date in the window.
    // This can trim a short window or repeat the round-robin cycle for a longer season.
    let rounds = fullRounds;
    let adjustedByEndDate = false;
    if (firstDate && genEndDate) {
      const end = new Date(`${genEndDate}T23:59:59`);
      let d = new Date(firstDate);
      let fit = 0;
      const maxGeneratedRounds = 500;
      while (fit < maxGeneratedRounds) {
        if (d.getTime() > end.getTime()) break;
        fit++;
        d = advanceByFrequency(d, genFrequency, customDaysNum);
      }
      if (fit !== fullRounds) adjustedByEndDate = true;
      rounds = Math.max(0, fit);
    }
    const totalMatches = rounds * matchesPerRound;
    let finishDate: Date | null = null;
    if (firstDate && rounds > 0) {
      let d = new Date(firstDate);
      for (let i = 1; i < rounds; i++) d = advanceByFrequency(d, genFrequency, customDaysNum);
      finishDate = d;
    }
    return { teamCount: n, rounds, fullRounds, matchesPerRound, totalMatches, firstDate, finishDate, adjustedByEndDate };
  }, [teamsInScope.length, genFirstRoundDate, genKickoff, genMatchDay, genFrequency, customDaysNum, genEndDate]);

  const capacityWarning = useMemo(() => {
    if (!summary || pitchCount <= 0) return null;
    if (summary.matchesPerRound <= pitchCount) return null;
    const slotsPerPitch = Math.ceil(summary.matchesPerRound / pitchCount);
    return { slotsPerPitch, completionMins: slotsPerPitch * (durationNum || 60) };
  }, [summary, pitchCount, durationNum]);

  const handleStartDateChange = (v: string) => {
    setGenFirstRoundDate(v);
    if (v && !matchDayManual) {
      const d = new Date(`${v}T12:00:00`);
      if (!isNaN(d.getTime())) setGenMatchDay(d.getDay());
    }
  };

  const buildPreviewRows = (shuffle = false) => {
    const teams = teamsInScope;
    if (teams.length < 2) {
      toast({ title: "Need at least 2 accepted teams", variant: "destructive" });
      return null;
    }
    const ids = shuffle ? shuffleArray(teams.map((t: any) => t.id)) : teams.map((t: any) => t.id);
    const nameById = new Map(teams.map((t: any) => [t.id, t.name as string]));
    const fx = buildRoundRobin(ids);
    const targetRounds = summary?.rounds ?? Math.max(...fx.map((f) => f.round));
    const fullRounds = Math.max(...fx.map((f) => f.round));
    return Array.from({ length: targetRounds }).flatMap((_, index) => {
      const displayRound = index + 1;
      const baseRound = (index % fullRounds) + 1;
      const shouldSwapHomeAway = Math.floor(index / fullRounds) % 2 === 1;
      return fx.filter((f) => f.round === baseRound).map((f) => {
        const home = shouldSwapHomeAway ? f.away : f.home;
        const away = shouldSwapHomeAway ? f.home : f.away;
        return {
          round: displayRound,
          home,
          away,
          homeName: nameById.get(home) ?? "?",
          awayName: nameById.get(away) ?? "?",
        };
      });
    });
  };

  const onPreview = () => {
    if (!genVenue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    const rows = buildPreviewRows(false);
    if (rows) setPreview(rows);
  };
  const onShuffle = () => { const r = buildPreviewRows(true); if (r) setPreview(r); };
  const onRegenerate = () => { const r = buildPreviewRows(false); if (r) setPreview(r); };

  const saveFixtures = async () => {
    if (!preview) return;
    setGenerating(true);
    const baseDate = genFirstRoundDate
      ? nextOccurrenceOfWeekday(new Date(`${genFirstRoundDate}T${genKickoff || "09:00"}:00`), genMatchDay)
      : null;
    if (baseDate && genKickoff) {
      const [hh, mm] = genKickoff.split(":").map(Number);
      baseDate.setHours(hh || 9, mm || 0, 0, 0);
    }
    const endDate = genEndDate ? new Date(`${genEndDate}T23:59:59`) : null;
    const duration = durationNum || null;
    const arrival = genArrival ? Number(genArrival) : null;
    const startRound = Math.max(1, Number(genStartRound) || 1);

    const roundDates = new Map<number, Date | null>();
    if (baseDate) {
      let d = new Date(baseDate);
      const maxRound = Math.max(...preview.map((p) => p.round));
      for (let r = 1; r <= maxRound; r++) {
        roundDates.set(r, new Date(d));
        d = advanceByFrequency(d, genFrequency, customDaysNum);
      }
    }

    const rows: any[] = [];
    const perRoundPitchIdx = new Map<number, number>();
    for (const f of preview) {
      const d = roundDates.get(f.round) ?? null;
      if (d && endDate && d.getTime() > endDate.getTime()) continue;
      let scheduledAt: string | null = d ? new Date(d).toISOString() : null;
      let pitch: string | null = null;
      if (pitchCount > 0) {
        const idx = perRoundPitchIdx.get(f.round) ?? 0;
        pitch = String((idx % pitchCount) + 1);
        if (genMode === "stagger" && d && durationNum > 0 && idx >= pitchCount) {
          const slot = Math.floor(idx / pitchCount);
          const shifted = new Date(d.getTime() + slot * durationNum * 60 * 1000);
          scheduledAt = shifted.toISOString();
        }
        perRoundPitchIdx.set(f.round, idx + 1);
      }
      rows.push({
        competition_id: competitionId,
        division_id: genDivisionId || null,
        round_number: (startRound - 1) + f.round,
        home_team_id: f.home,
        away_team_id: f.away,
        status: "scheduled",
        created_by: user?.id ?? null,
        scheduled_at: scheduledAt,
        venue: genVenue,
        pitch_number: pitch,
        duration_minutes: duration,
        arrival_minutes_before: arrival,
      });
    }

    if (rows.length === 0) {
      setGenerating(false);
      toast({ title: "No fixtures fit the date window", description: "Adjust the end date or frequency.", variant: "destructive" });
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
    setPreview(null);
    setGenDivisionId(""); setGenFirstRoundDate(""); setGenKickoff("09:00");
    setGenFrequency("weekly"); setGenCustomDays("7"); setGenEndDate(""); setGenStartRound("1");
    setGenVenue(""); setGenDuration("60"); setGenArrival(""); setGenAutoPitches("");
    setMatchDayManual(false); setAdvancedOpen(false);
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
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

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="space-y-2">
          {!genOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setGenOpen(true)}
                disabled={!canGenerate}
                title={canGenerate ? undefined : "Needs at least 2 accepted teams"}
              >
                <CalendarPlus className="h-4 w-4 mr-1" /> Generate round-robin
              </Button>
              <AddMatchButton competitionId={competitionId} entries={entries} divisions={divisions} />
              {!canGenerate && (
                <span className="text-xs text-muted-foreground">
                  Needs at least 2 accepted teams to generate a round-robin.
                </span>
              )}
            </div>
          ) : (
            <Card className="w-full">
              <CardContent className="p-4 space-y-4">
                {!preview ? (
                  <>
                    <div>
                      <Label>Division (optional)</Label>
                      <Select value={genDivisionId || "_all"} onValueChange={(v) => setGenDivisionId(v === "_all" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="All accepted teams" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_all">All accepted teams</SelectItem>
                          {divisions.map((d: any) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <Label>Competition starts</Label>
                          <Input type="date" value={genFirstRoundDate} onChange={(e) => handleStartDateChange(e.target.value)} />
                        </div>
                        <div>
                          <Label>Match day</Label>
                          <Select
                            value={String(genMatchDay)}
                            onValueChange={(v) => { setGenMatchDay(Number(v)); setMatchDayManual(true); }}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {WEEKDAYS.map((d, i) => (
                                <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                        {genFrequency === "custom" && (
                          <div className="col-span-2">
                            <Label>Days between rounds</Label>
                            <Input type="number" inputMode="numeric" min={1} value={genCustomDays} onChange={(e) => setGenCustomDays(e.target.value)} />
                          </div>
                        )}
                        <div>
                          <Label>Start time</Label>
                          <Input type="time" value={genKickoff} onChange={(e) => setGenKickoff(e.target.value)} />
                        </div>
                        <div>
                          <Label>Duration (mins)</Label>
                          <Input type="number" inputMode="numeric" min={0} value={genDuration} onChange={(e) => setGenDuration(e.target.value)} />
                        </div>
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
                      <div className="col-span-2">
                        <Label>Available pitches / courts</Label>
                        <Input type="number" inputMode="numeric" min={0} value={genAutoPitches} onChange={(e) => setGenAutoPitches(e.target.value)} placeholder="e.g. 2" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Scheduling mode</Label>
                      <RadioGroup value={genMode} onValueChange={(v) => setGenMode(v as SchedulingMode)} className="space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <RadioGroupItem value="simultaneous" id="mode-sim" className="mt-1" />
                          <div className="text-sm">
                            <div className="font-medium">Simultaneous kick-off</div>
                            <div className="text-xs text-muted-foreground">All matches start together where pitches allow.</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <RadioGroupItem value="stagger" id="mode-stagger" className="mt-1" />
                          <div className="text-sm">
                            <div className="font-medium">Auto-stagger matches</div>
                            <div className="text-xs text-muted-foreground">Spreads matches across available pitches and timeslots.</div>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>

                    {summary && (
                      <Card className="bg-muted/40 border-dashed">
                        <CardContent className="p-3 space-y-1 text-sm">
                          <div className="font-semibold mb-1">Competition summary</div>
                          <div>· {summary.teamCount} teams</div>
                          <div>
                            · {summary.rounds} rounds{summary.adjustedByEndDate ? ` (${summary.rounds < summary.fullRounds ? "capped" : "extended"} by end date)` : ""}
                          </div>
                          <div>· {summary.totalMatches} total matches</div>
                          {pitchCount > 0 && <div>· {pitchCount} available pitches</div>}
                          <div>· Matches {frequencyLabel[genFrequency]} on {WEEKDAYS[genMatchDay]}</div>
                          {summary.firstDate && <div>· Starts {format(summary.firstDate, "EEE d MMM yyyy")}</div>}
                          {summary.finishDate && <div>· Estimated finish {format(summary.finishDate, "EEE d MMM yyyy")}</div>}
                        </CardContent>
                      </Card>
                    )}

                    {capacityWarning && summary && (
                      <Card className="border-amber-500/50 bg-amber-500/10">
                        <CardContent className="p-3 text-sm space-y-2">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                            <div className="font-medium">
                              Round 1 requires {summary.matchesPerRound} matches but only {pitchCount} pitch{pitchCount === 1 ? "" : "es"} available.
                            </div>
                          </div>
                          {genMode === "stagger" ? (
                            <div className="text-xs text-muted-foreground">
                              Ignite will stagger {capacityWarning.slotsPerPitch} slots per pitch, ~{capacityWarning.completionMins} min to complete the round.
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              Switch to “Auto-stagger” or add more pitches to fit all matches.
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
                            <Label>Competition end date (optional)</Label>
                            <Input type="date" value={genEndDate} onChange={(e) => setGenEndDate(e.target.value)} />
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
                            Home/away alternates each round for fairness. Setting an end date repeats the cycle within that window, swapping home/away each cycle. Leave the start date blank to generate fixtures without times and fill them in per match later.
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
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">Fixture preview</div>
                      <Badge variant="secondary">{preview.length} matches</Badge>
                    </div>
                    <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                      {Array.from(new Set(preview.map((p) => p.round))).map((r) => (
                        <div key={r} className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">Round {r}</div>
                          {preview.filter((p) => p.round === r).map((p, i) => (
                            <div key={i} className="text-sm flex items-center gap-2">
                              <span className="flex-1 text-right truncate">{p.homeName}</span>
                              <span className="text-muted-foreground">vs</span>
                              <span className="flex-1 truncate">{p.awayName}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={saveFixtures} disabled={generating}>
                        {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                        Save fixtures
                      </Button>
                      <Button size="sm" variant="outline" onClick={onShuffle} disabled={generating}>
                        <Shuffle className="h-4 w-4 mr-1" /> Shuffle
                      </Button>
                      <Button size="sm" variant="outline" onClick={onRegenerate} disabled={generating}>
                        <RefreshCw className="h-4 w-4 mr-1" /> Regenerate
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={generating}>Back</Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}


      {matches.length === 0 ? (
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
      ) : (
        matches.map((m: any) => (
          <MatchRow key={m.id} match={m} isAdmin={isAdmin} competitionId={competitionId} />
        ))
      )}
    </div>
  );
}

function MatchRow({ match, isAdmin, competitionId }: { match: any; isAdmin: boolean; competitionId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? "");
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? "");
  const [status, setStatus] = useState<string>(match.status);

  const save = async () => {
    const homeN = home === "" ? null : Number(home);
    const awayN = away === "" ? null : Number(away);
    const { error } = await supabase
      .from("competition_matches")
      .update({ home_score: homeN, away_score: awayN, status })
      .eq("id", match.id);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match updated" });
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

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {match.round_number != null && <Badge variant="outline">Round {match.round_number}</Badge>}
          {match.competition_divisions?.name && <span>{match.competition_divisions.name}</span>}
          {match.scheduled_at && <span>· {format(new Date(match.scheduled_at), "EEE d MMM HH:mm")}</span>}
          {match.venue && <span>· {match.venue}{match.pitch_number ? ` — Pitch ${match.pitch_number}` : ""}</span>}
          <Badge variant="secondary" className="capitalize ml-auto">{match.status.replace("_", " ")}</Badge>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1 font-medium truncate text-right">{match.home?.name ?? "?"}</span>
          <span className="px-2 font-bold tabular-nums">
            {match.home_score ?? "–"} : {match.away_score ?? "–"}
          </span>
          <span className="flex-1 font-medium truncate">{match.away?.name ?? "?"}</span>
        </div>
        {isAdmin && (
          <div className="pt-2">
            {!editing ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit result</Button>
                <Button size="sm" variant="ghost" onClick={remove}><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label>Home</Label>
                    <Input type="number" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} />
                  </div>
                  <div>
                    <Label>Away</Label>
                    <Input type="number" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["scheduled","in_progress","completed","postponed","cancelled"].map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddMatchButton({ competitionId, entries, divisions }: { competitionId: string; entries: any[]; divisions: any[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
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
  };

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add match</Button>;
  }
  return (
    <Card className="w-full">
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
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
          <div>
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
          <div>
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
          <div>
            <Label>Start date <span className="text-destructive">*</span></Label>
            <Input
              type="date"
              required
              value={scheduledAt ? scheduledAt.split("T")[0] : ""}
              onChange={(e) => {
                const time = scheduledAt.split("T")[1] || "09:00";
                setScheduledAt(e.target.value ? `${e.target.value}T${time}` : "");
              }}
            />
          </div>
          <div>
            <Label>Start time <span className="text-destructive">*</span></Label>
            <Input
              type="time"
              required
              value={scheduledAt ? (scheduledAt.split("T")[1] || "") : ""}
              onChange={(e) => {
                const date = scheduledAt.split("T")[0];
                if (date) setScheduledAt(`${date}T${e.target.value}`);
              }}
            />
          </div>
          <div className="col-span-2">
            <Label>Round (optional)</Label>
            <Input type="number" inputMode="numeric" min={1} value={round} onChange={(e) => setRound(e.target.value)} />
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
          <div>
            <Label>Pitch / Court #</Label>
            <Input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="e.g. 3" />
          </div>
          <div>
            <Label>Duration (mins)</Label>
            <Input type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 90" />
          </div>
          <div>
            <Label>Arrive (mins before)</Label>
            <Input type="number" inputMode="numeric" min={0} value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="e.g. 30" />
          </div>
          <div className="col-span-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the team event" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A team event is created for both sides so players can RSVP.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CompetitionLadderPanel({ competitionId, divisions }: { competitionId: string; divisions: any[] }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["competition-ladder", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_ladder")
        .select("*, teams:team_id(id, name)")
        .eq("competition_id", competitionId)
        .order("points", { ascending: false })
        .order("goal_diff", { ascending: false })
        .order("goals_for", { ascending: false });
      return data ?? [];
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold">No ladder yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Once match results are entered, standings will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hiddenDivisionIds = new Set(
    divisions.filter((d: any) => d.hide_ladder).map((d: any) => d.id)
  );
  const groups = new Map<string, any[]>();
  rows.forEach((r: any) => {
    if (r.division_id && hiddenDivisionIds.has(r.division_id)) return;
    const key = r.division_id ?? "__none";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });

  if (groups.size === 0) {
    return <p className="text-sm text-muted-foreground">Ladder is hidden for all divisions in this competition.</p>;
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([divId, list]) => {
        const div = divisions.find((d: any) => d.id === divId);
        return (
          <Card key={divId}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-primary" />
                <div className="font-medium">{div?.name ?? "Overall"}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5">#</th>
                      <th>Team</th>
                      <th className="text-right">P</th>
                      <th className="text-right">W</th>
                      <th className="text-right">D</th>
                      <th className="text-right">L</th>
                      <th className="text-right">+/-</th>
                      <th className="text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any, i: number) => (
                      <tr key={r.team_id} className="border-t">
                        <td className="py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="font-medium truncate">{r.teams?.name ?? "?"}</td>
                        <td className="text-right tabular-nums">{r.played}</td>
                        <td className="text-right tabular-nums">{r.wins}</td>
                        <td className="text-right tabular-nums">{r.draws}</td>
                        <td className="text-right tabular-nums">{r.losses}</td>
                        <td className="text-right tabular-nums">{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
                        <td className="text-right tabular-nums font-bold">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
