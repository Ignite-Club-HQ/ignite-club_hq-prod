import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreateCompetitionEventButton } from "./CreateCompetitionEventButton";

/**
 * Shown on the Create Event page: lets competition organisers (owners/admins,
 * league admins of the organising club) create one competition-wide event.
 * Renders nothing when the user can't organise any competition.
 */
export function CompetitionEventPicker() {
  const { user } = useAuth();
  const [competitionId, setCompetitionId] = useState("");

  const { data: competitions = [] } = useQuery({
    queryKey: ["organisable-competitions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("competitions")
        .select("id, name, status")
        .order("name");
      const rows = ((data as any[]) || []).filter((c) => c.status !== "archived");
      const checks = await Promise.all(
        rows.map(async (c) => {
          const { data: ok } = await supabase.rpc("can_create_competition_event" as any, {
            _user_id: user!.id,
            _competition_id: c.id,
          });
          return ok === true ? c : null;
        }),
      );
      return checks.filter(Boolean) as { id: string; name: string }[];
    },
  });

  const { data: teamCount = 0 } = useQuery({
    queryKey: ["competition-accepted-count", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("competition_entries")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("status", "accepted");
      return count ?? 0;
    },
  });

  if (competitions.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <Label className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" />
        Event for a whole competition?
      </Label>
      <Select value={competitionId} onValueChange={setCompetitionId}>
        <SelectTrigger><SelectValue placeholder="Choose a competition" /></SelectTrigger>
        <SelectContent>
          {competitions.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {competitionId && (
        <CreateCompetitionEventButton competitionId={competitionId} teamCount={teamCount} />
      )}
    </div>
  );
}
