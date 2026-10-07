import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type EventType = "social" | "training" | "game";

/**
 * Lets competition organisers (owners/admins, league admins) create ONE
 * competition-wide event (not per-team copies). Everyone on accepted teams
 * (plus parents/guardians) is invited and can RSVP.
 */
export function CreateCompetitionEventButton({
  competitionId,
  teamCount,
}: {
  competitionId: string;
  teamCount: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("social");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle(""); setType("social"); setDate(""); setTime("18:00");
    setEndTime(""); setLocation(""); setDescription("");
  };

  const submit = async () => {
    if (!title.trim() || !date || !time) {
      toast({ title: "Add a title, date and time", variant: "destructive" });
      return;
    }
    const start = new Date(`${date}T${time}`);
    let end: Date | null = null;
    if (endTime) {
      end = new Date(`${date}T${endTime}`);
      if (end <= start) {
        toast({ title: "End time must be after the start time", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("create_competition_event" as any, {
      p_competition_id: competitionId,
      p_title: title.trim(),
      p_type: type,
      p_event_date: start.toISOString(),
      p_location: location.trim() || null,
      p_description: description.trim() || null,
      p_end_time: end ? end.toISOString() : null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't create event", description: error.message, variant: "destructive" });
      return;
    }
    const n = Number(data ?? 0);
    toast({
      title: "Event created",
      description: n > 0
        ? `${n} ${n === 1 ? "person has" : "people have"} been invited.`
        : "No one to invite yet — it's still listed on the competition page.",
    });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["competition-events", competitionId] });
    reset();
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)} disabled={teamCount === 0}>
        <CalendarPlus className="h-4 w-4 mr-2" />
        Create competition event
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Competition event</DialogTitle>
            <DialogDescription>
              One event for the whole competition. Everyone on the {teamCount} entered {teamCount === 1 ? "team" : "teams"} is invited and can RSVP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ce-title">Title</Label>
              <Input id="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Presentation night" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as EventType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="social">Social / meeting</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                  <SelectItem value="game">Game</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5 col-span-3 sm:col-span-1">
                <Label htmlFor="ce-date">Date</Label>
                <Input id="ce-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-time">Start</Label>
                <Input id="ce-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-end">End (optional)</Label>
                <Input id="ce-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-loc">Location (optional)</Label>
              <Input id="ce-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bridgewater Oval clubrooms" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-desc">Details (optional)</Label>
              <Textarea id="ce-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create & invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
