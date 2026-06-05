import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trophy, CalendarPlus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

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
  const [genDaysBetween, setGenDaysBetween] = useState<string>("7");
  const [genVenue, setGenVenue] = useState<string>("");
  const [genDuration, setGenDuration] = useState<string>("");
  const [genArrival, setGenArrival] = useState<string>("");
  const [genAutoPitches, setGenAutoPitches] = useState<string>("");
  const [generating, setGenerating] = useState(false);

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

  const generate = async () => {
    const teams = acceptedByDivision(genDivisionId || null);
    if (teams.length < 2) {
      toast({ title: "Need at least 2 accepted teams", variant: "destructive" });
      return;
    }
    if (!genVenue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    setGenerating(true);
    const fixtures = buildRoundRobin(teams.map((t: any) => t.id));
    const daysBetween = Math.max(0, Number(genDaysBetween) || 0);
    const baseDate = genFirstRoundDate ? new Date(`${genFirstRoundDate}T${genKickoff || "09:00"}:00`) : null;
    const duration = genDuration ? Number(genDuration) : null;
    const arrival = genArrival ? Number(genArrival) : null;
    const pitchCount = Math.max(0, Number(genAutoPitches) || 0);
    // Track per-round pitch counter so each round starts at 1
    const roundPitchCounter = new Map<number, number>();
    const rows = fixtures.map((f) => {
      let scheduledAt: string | null = null;
      if (baseDate && !isNaN(baseDate.getTime())) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + (f.round - 1) * daysBetween);
        scheduledAt = d.toISOString();
      }
      let pitch: string | null = null;
      if (pitchCount > 0) {
        const used = roundPitchCounter.get(f.round) ?? 0;
        pitch = String((used % pitchCount) + 1);
        roundPitchCounter.set(f.round, used + 1);
      }
      return {
        competition_id: competitionId,
        division_id: genDivisionId || null,
        round_number: f.round,
        home_team_id: f.home,
        away_team_id: f.away,
        status: "scheduled",
        created_by: user?.id ?? null,
        scheduled_at: scheduledAt,
        venue: genVenue,
        pitch_number: pitch,
        duration_minutes: duration,
        arrival_minutes_before: arrival,
      } as any;
    });
    const { error } = await supabase.from("competition_matches").insert(rows);
    setGenerating(false);
    if (error) {
      toast({ title: "Could not generate fixtures", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Generated ${rows.length} fixtures` });
    setGenOpen(false);
    setGenDivisionId(""); setGenFirstRoundDate(""); setGenKickoff("09:00");
    setGenDaysBetween("7"); setGenVenue(""); setGenDuration(""); setGenArrival(""); setGenAutoPitches("");
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const totalAccepted = entries.filter((e: any) => e.status === "accepted").length;
  const canGenerate = totalAccepted >= 2;

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
              <CardContent className="p-4 space-y-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>First round date</Label>
                    <Input type="date" value={genFirstRoundDate} onChange={(e) => setGenFirstRoundDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Start time</Label>
                    <Input type="time" value={genKickoff} onChange={(e) => setGenKickoff(e.target.value)} />
                  </div>
                  <div>
                    <Label>Days between rounds</Label>
                    <Input type="number" inputMode="numeric" min={0} value={genDaysBetween} onChange={(e) => setGenDaysBetween(e.target.value)} />
                  </div>
                  <div>
                    <Label>Default venue <span className="text-destructive">*</span></Label>
                    <Input required value={genVenue} onChange={(e) => setGenVenue(e.target.value)} placeholder="e.g. Main Oval" />
                  </div>
                  <div>
                    <Label># of pitches/courts (auto-assign)</Label>
                    <Input type="number" inputMode="numeric" min={0} value={genAutoPitches} onChange={(e) => setGenAutoPitches(e.target.value)} placeholder="e.g. 3" />
                  </div>
                  <div>
                    <Label>Duration (mins)</Label>
                    <Input type="number" inputMode="numeric" min={0} value={genDuration} onChange={(e) => setGenDuration(e.target.value)} placeholder="e.g. 90" />
                  </div>
                  <div>
                    <Label>Arrive (mins before)</Label>
                    <Input type="number" inputMode="numeric" min={0} value={genArrival} onChange={(e) => setGenArrival(e.target.value)} placeholder="e.g. 30" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Each accepted team plays every other team once. Home/away alternates per round.
                  Leave date blank to generate without times — you can fill them in per match later.
                  Scheduled fixtures automatically create a team event so players can RSVP.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={generate} disabled={generating}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Generate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
                </div>
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
          <div className="col-span-2">
            <Label>Venue (optional)</Label>
            <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Main Oval" />
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
