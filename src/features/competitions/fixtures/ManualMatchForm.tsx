import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { buildManualMatchRow, createManualMatch } from "./manualMatchWorkflow";
import { competitionFixtureKeys } from "./queryKeys";
import type { CompetitionDivisionSummary, CompetitionEntrySummary } from "./types";

export function AddMatchMenuItem(props: { competitionId: string; entries: CompetitionEntrySummary[]; divisions: CompetitionDivisionSummary[] }) {
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
          <ManualMatchForm {...props} defaultOpen onSaved={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
export function ManualMatchForm({ competitionId, entries, divisions, defaultOpen = false, onSaved }: { competitionId: string; entries: CompetitionEntrySummary[]; divisions: CompetitionDivisionSummary[]; defaultOpen?: boolean; onSaved?: () => void }) {
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

  const accepted = entries.filter((entry) => entry.status === "accepted");

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
    const row = buildManualMatchRow({
      competitionId,
      homeTeamId: homeId,
      awayTeamId: awayId,
      divisionId,
      scheduledAt,
      venue,
      pitch,
      round,
      duration,
      arrival,
      notes,
      createdBy: user?.id,
    });
    const { error } = await createManualMatch(row);
    setSaving(false);
    if (error) {
      toast({ title: "Could not add match", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match added" });
    setOpen(false); reset();
    qc.invalidateQueries({ queryKey: competitionFixtureKeys.matches(competitionId) });
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
              {accepted.map((entry) => (
                <SelectItem key={entry.team_id} value={entry.team_id}>{entry.teams?.name}</SelectItem>
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
              {accepted.map((entry) => (
                <SelectItem key={entry.team_id} value={entry.team_id}>{entry.teams?.name}</SelectItem>
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
              {divisions.map((division) => (
                <SelectItem key={division.id} value={division.id}>{division.name}</SelectItem>
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
