import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Lock, Users, Building2 } from "lucide-react";
import { toast } from "sonner";
import { saveDrill } from "./drillStorage";
import type { DrillFrame, DrillMetadata } from "./types";

interface SaveDrillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, the drill is updated; otherwise inserted */
  drillId?: string;
  initialName?: string;
  initialMetadata?: DrillMetadata;
  initialVisibility?: "private" | "team" | "club";
  frames: DrillFrame[];
  /** Current team context, enables the "Share with team" option */
  teamId?: string | null;
  teamName?: string;
  /** Current club context, enables the "Share with club" option */
  clubId?: string | null;
  clubName?: string;
  onSaved: (drillId: string) => void;
}

export function SaveDrillDialog({
  open,
  onOpenChange,
  drillId,
  initialName = "",
  initialMetadata,
  initialVisibility = "private",
  frames,
  teamId,
  teamName,
  clubId,
  clubName,
  onSaved,
}: SaveDrillDialogProps) {
  const [name, setName] = useState(initialName);
  const [ageGroup, setAgeGroup] = useState(initialMetadata?.ageGroup ?? "");
  const [focus, setFocus] = useState((initialMetadata?.focus ?? []).join(", "));
  const [duration, setDuration] = useState(
    initialMetadata?.durationMinutes != null ? String(initialMetadata.durationMinutes) : ""
  );
  const [players, setPlayers] = useState(
    initialMetadata?.playersRequired != null ? String(initialMetadata.playersRequired) : ""
  );
  const [coachingPoints, setCoachingPoints] = useState(
    (initialMetadata?.coachingPoints ?? []).join("\n")
  );
  const [visibility, setVisibility] = useState<"private" | "team" | "club">(initialVisibility);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a drill name");
      return;
    }
    setSaving(true);
    try {
      const id = await saveDrill({
        id: drillId,
        name,
        metadata: {
          ageGroup: ageGroup || undefined,
          focus: focus
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          durationMinutes: duration ? Number(duration) : undefined,
          playersRequired: players ? Number(players) : undefined,
          coachingPoints: coachingPoints
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          equipment: initialMetadata?.equipment ?? [],
          progression: initialMetadata?.progression,
          regression: initialMetadata?.regression,
        },
        frames,
        visibility,
        teamId: teamId ?? null,
        clubId: clubId ?? null,
      });
      toast.success(drillId ? "Drill updated" : "Drill saved");
      onSaved(id);
      onOpenChange(false);
    } catch (err: any) {
      console.error("[SaveDrillDialog] save failed", err);
      toast.error(err?.message ?? "Failed to save drill");
    } finally {
      setSaving(false);
    }
  };

  const canShareTeam = !!teamId;
  const canShareClub = !!clubId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{drillId ? "Update drill" : "Save drill"}</DialogTitle>
          <DialogDescription>
            {frames.length} frame{frames.length === 1 ? "" : "s"} will be saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="drill-name">Name</Label>
            <Input
              id="drill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rondo 5v2"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="drill-age">Age group</Label>
              <Input
                id="drill-age"
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                placeholder="U10, U12..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drill-duration">Duration (min)</Label>
              <Input
                id="drill-duration"
                type="number"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="15"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="drill-players">Players</Label>
              <Input
                id="drill-players"
                type="number"
                inputMode="numeric"
                value={players}
                onChange={(e) => setPlayers(e.target.value)}
                placeholder="8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drill-focus">Focus (comma-sep.)</Label>
              <Input
                id="drill-focus"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="passing, pressing"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drill-coaching">Coaching points</Label>
            <Textarea
              id="drill-coaching"
              value={coachingPoints}
              onChange={(e) => setCoachingPoints(e.target.value)}
              placeholder="One per line..."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  <span className="inline-flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5" />
                    Private — only me
                  </span>
                </SelectItem>
                <SelectItem value="team" disabled={!canShareTeam}>
                  <span className="inline-flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" />
                    Team {teamName ? `— ${teamName}` : ""}
                  </span>
                </SelectItem>
                <SelectItem value="club" disabled={!canShareClub}>
                  <span className="inline-flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5" />
                    Club {clubName ? `— ${clubName}` : ""}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {drillId ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
