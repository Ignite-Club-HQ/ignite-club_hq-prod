import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Trophy } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  teamId: string;
  /** True when the current user can edit team settings. */
  canEdit: boolean;
}

interface TeamLink {
  playhq_team_id: string | null;
  playhq_grade_id: string | null;
  playhq_season_id: string | null;
  playhq_auto_create_events: boolean;
  club_id: string | null;
}

/**
 * PlayHQ ladder + fixtures for a team. Reads from the mirror tables that the
 * `playhq-sync` edge function fills. Until the user has a real API key the
 * function falls back to mock data, so this UI works end-to-end today.
 */
export function TeamPlayHQPanel({ teamId, canEdit }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [gradeInput, setGradeInput] = useState("");
  const [teamInput, setTeamInput] = useState("");
  const [tenantInput, setTenantInput] = useState("");

  const { data: link } = useQuery({
    queryKey: ["team-playhq-link", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select(
          "playhq_team_id, playhq_grade_id, playhq_season_id, playhq_auto_create_events, club_id",
        )
        .eq("id", teamId)
        .maybeSingle();
      return (data ?? null) as TeamLink | null;
    },
  });

  const { data: club } = useQuery({
    queryKey: ["team-playhq-club", link?.club_id],
    enabled: !!link?.club_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("playhq_tenant")
        .eq("id", link!.club_id!)
        .maybeSingle();
      return data;
    },
  });

  const gradeId = link?.playhq_grade_id ?? null;
  const tenant = club?.playhq_tenant ?? null;

  const { data: ladder = [] } = useQuery({
    queryKey: ["playhq-ladder", gradeId],
    enabled: !!gradeId,
    queryFn: async () => {
      const { data } = await supabase
        .from("playhq_ladder")
        .select("*")
        .eq("playhq_grade_id", gradeId!)
        .order("position", { ascending: true });
      return data ?? [];
    },
  });

  const { data: fixtures = [] } = useQuery({
    queryKey: ["playhq-fixtures", gradeId],
    enabled: !!gradeId,
    queryFn: async () => {
      const { data } = await supabase
        .from("playhq_fixtures")
        .select("*")
        .eq("playhq_grade_id", gradeId!)
        .order("scheduled_at", { ascending: true });
      return data ?? [];
    },
  });

  const saveLink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("teams")
        .update({
          playhq_grade_id: gradeInput.trim() || null,
          playhq_team_id: teamInput.trim() || null,
        })
        .eq("id", teamId);
      if (error) throw error;
      if (tenantInput.trim() && link?.club_id) {
        await supabase
          .from("clubs")
          .update({ playhq_tenant: tenantInput.trim() })
          .eq("id", link.club_id);
      }
    },
    onSuccess: () => {
      toast.success("Linked to PlayHQ");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["team-playhq-link", teamId] });
      qc.invalidateQueries({ queryKey: ["team-playhq-club"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const toggleAuto = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("teams")
        .update({ playhq_auto_create_events: next })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-playhq-link", teamId] }),
  });

  const sync = useMutation({
    mutationFn: async () => {
      if (!gradeId) throw new Error("Link a PlayHQ grade first");
      const { data, error } = await supabase.functions.invoke("playhq-sync", {
        body: { grade_id: gradeId, tenant: tenant ?? "mock", mock: !tenant },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      toast.success(
        r?.mock
          ? `Synced ${r.fixtures} fixtures (mock data — no API key yet)`
          : `Synced ${r?.fixtures ?? 0} fixtures, ${r?.ladder ?? 0} ladder rows`,
      );
      qc.invalidateQueries({ queryKey: ["playhq-ladder", gradeId] });
      qc.invalidateQueries({ queryKey: ["playhq-fixtures", gradeId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Sync failed"),
  });

  if (!link) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            PlayHQ
          </CardTitle>
          {gradeId && (
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Refresh</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!gradeId && !editing && (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>No PlayHQ grade linked yet.</p>
            {canEdit && (
              <Button size="sm" onClick={() => setEditing(true)}>
                Link to PlayHQ
              </Button>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">PlayHQ tenant (sport body code)</Label>
              <Input
                placeholder="e.g. bv, netball, afl"
                value={tenantInput}
                onChange={(e) => setTenantInput(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Grade ID</Label>
              <Input
                placeholder="From the PlayHQ grade URL"
                value={gradeInput}
                onChange={(e) => setGradeInput(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Team ID (optional)</Label>
              <Input
                placeholder="PlayHQ team id"
                value={teamInput}
                onChange={(e) => setTeamInput(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveLink.mutate()} disabled={saveLink.isPending}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {gradeId && (
          <>
            <div className="flex items-center justify-between rounded-md bg-muted/30 p-2.5">
              <div className="text-xs">
                <div className="font-medium">Auto-create Ignite events</div>
                <div className="text-muted-foreground">
                  Mirror PlayHQ fixtures as RSVP-able events
                </div>
              </div>
              <Switch
                disabled={!canEdit}
                checked={link.playhq_auto_create_events}
                onCheckedChange={(v) => toggleAuto.mutate(v)}
              />
            </div>

            {ladder.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                  Ladder
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1">#</th>
                        <th>Team</th>
                        <th className="text-right">P</th>
                        <th className="text-right">W</th>
                        <th className="text-right">L</th>
                        <th className="text-right">+/-</th>
                        <th className="text-right">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ladder.map((r: any) => (
                        <tr
                          key={r.playhq_team_id}
                          className={
                            r.playhq_team_id === link.playhq_team_id
                              ? "bg-primary/10 font-medium"
                              : "border-t"
                          }
                        >
                          <td className="py-1 tabular-nums">{r.position}</td>
                          <td className="truncate">{r.team_name}</td>
                          <td className="text-right tabular-nums">{r.played}</td>
                          <td className="text-right tabular-nums">{r.wins}</td>
                          <td className="text-right tabular-nums">{r.losses}</td>
                          <td className="text-right tabular-nums">
                            {r.points_diff > 0 ? `+${r.points_diff}` : r.points_diff}
                          </td>
                          <td className="text-right tabular-nums font-bold">{r.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {fixtures.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                  Fixtures & results
                </h3>
                <div className="space-y-1.5">
                  {fixtures.map((f: any) => (
                    <div
                      key={f.playhq_game_id}
                      className="rounded-md border p-2 text-sm space-y-0.5"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {f.round && <Badge variant="outline">{f.round}</Badge>}
                        {f.scheduled_at && (
                          <span>{format(new Date(f.scheduled_at), "EEE d MMM HH:mm")}</span>
                        )}
                        {f.status && (
                          <Badge variant="secondary" className="ml-auto capitalize">
                            {f.status.toLowerCase()}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate text-right">{f.home_team_name}</span>
                        <span className="px-2 font-bold tabular-nums">
                          {f.home_score ?? "–"} : {f.away_score ?? "–"}
                        </span>
                        <span className="flex-1 truncate">{f.away_team_name}</span>
                      </div>
                      {f.venue_name && (
                        <div className="text-[11px] text-muted-foreground">
                          {f.venue_name}
                          {f.court ? ` · ${f.court}` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Change link
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
