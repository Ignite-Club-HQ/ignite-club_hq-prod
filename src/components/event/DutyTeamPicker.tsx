/**
 * Optional "Team on duty" picker (events.duty_team_id). Lists only the
 * club's active teams — archived / deleted teams never appear. Independent
 * of the event's own team. The whole duty team receives a duty reminder via
 * send-event-reminders; individual duties are unaffected.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";

export function useActiveClubTeams(clubId: string | null | undefined) {
  return useQuery({
    queryKey: ["duty-team-options", clubId],
    enabled: !!clubId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_archived, lifecycle_status")
        .eq("club_id", clubId!)
        .is("deleted_at", null)
        .eq("is_archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((t: any) => t.lifecycle_status !== "archived") as { id: string; name: string }[];
    },
  });
}

export function DutyTeamPicker({
  clubId,
  value,
  onChange,
  label,
  onLabelChange,
}: {
  clubId: string | null | undefined;
  value: string | null;
  onChange: (next: string | null) => void;
  label?: string;
  onLabelChange?: (next: string) => void;
}) {
  const { data: teams } = useActiveClubTeams(clubId);
  if (!clubId) return null;
  // If the saved team was archived since, it's not listed — show as none.
  const current = value && teams?.some((t) => t.id === value) ? value : NONE;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">Team on duty</Label>
      <Select value={current} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger><SelectValue placeholder="No team on duty" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No team on duty</SelectItem>
          {(teams ?? []).map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current !== NONE && onLabelChange && (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="duty-team-label" className="text-sm font-medium">Duty</Label>
          <Input
            id="duty-team-label"
            value={label ?? ""}
            maxLength={60}
            placeholder="e.g. BBQ or Canteen 5–7pm"
            onChange={(e) => onLabelChange(e.target.value)}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The whole team (and players' parents) get a duty reminder, e.g. BBQ or canteen. Individual duties still work as usual.
      </p>
    </div>
  );
}
