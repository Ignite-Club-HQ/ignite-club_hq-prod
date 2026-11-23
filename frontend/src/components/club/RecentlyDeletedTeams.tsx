import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { useToast } from "@/hooks/use-toast";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

interface DeletedTeam { id: string; name: string; deleted_at: string }

const DAY_MS = 24 * 60 * 60 * 1000;

/** Club admins' "Recently deleted" list of soft-deleted teams, with restore and permanent delete. */
export function RecentlyDeletedTeams({ clubId }: { clubId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedTeam | null>(null);
  const icp = isFeatureRoutedToIcp("membership");

  const { data: teams = [] } = useQuery({
    queryKey: ["club-deleted-teams", clubId],
    queryFn: async (): Promise<DeletedTeam[]> => {
      if (icp) {
        return withFeatureBackend("membership", {
          supabase: async () => [],
          icp: async (ctx) => {
            const { listLiveTeams } = await import("@/live/features/club");
            const rows = await listLiveTeams(ctx, clubId);
            return rows
              .filter((t) => t.deleted_at_ms.length > 0)
              .map((t) => ({ id: t.id, name: t.name, deleted_at: new Date(Number(t.deleted_at_ms[0])).toISOString() }));
          },
        }, { clubId });
      }
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, deleted_at")
        .eq("club_id", clubId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DeletedTeam[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["club-deleted-teams", clubId] });
    queryClient.invalidateQueries({ queryKey: ["club-teams", clubId] });
  };

  const restore = async (team: DeletedTeam) => {
    setBusyId(team.id);
    try {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { error } = await supabase.from("teams").update({ deleted_at: null, deleted_by: null } as any).eq("id", team.id);
          if (error) throw error;
        },
        icp: async (ctx) => { await (await import("@/live/features/club")).restoreLiveTeam(ctx, team.id); },
      }, writeOnce({ clubId, teamId: team.id }));
      toast({ title: "Team restored", description: `${team.name} is back in your club.` });
      refresh();
    } catch (error) {
      console.warn("[RecentlyDeletedTeams] restore failed", error);
      toast({ title: "Couldn't restore team", description: "Please try again. If the club is at its team limit, free a team slot first.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    const team = purgeTarget;
    if (!team) return;
    setBusyId(team.id);
    try {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.functions.invoke("permanent-delete-entity", { body: { entityType: "team", entityId: team.id } });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
        },
        icp: async (ctx) => { await (await import("@/live/features/club")).deleteLiveTeamPermanent(ctx, team.id, team.name); },
      }, writeOnce({ clubId, teamId: team.id }));
      setPurgeTarget(null);
      toast({ title: "Team permanently deleted", description: "This can't be undone in the app." });
      refresh();
    } catch (error) {
      console.warn("[RecentlyDeletedTeams] permanent delete failed", error);
      toast({ title: "Couldn't delete team", description: "Nothing was deleted. Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (teams.length === 0) return null;

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-muted-foreground" />
          Recently deleted teams
        </h2>
        <p className="text-xs text-muted-foreground">Kept for at least 30 days. Only club admins can see this.</p>
      </div>
      {teams.map((team) => {
        const daysLeft = 30 - Math.floor((Date.now() - new Date(team.deleted_at).getTime()) / DAY_MS);
        return (
          <Card key={team.id} className="border-dashed">
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{team.name}</p>
                <p className="text-xs text-muted-foreground">
                  Deleted {new Date(team.deleted_at).toLocaleDateString()} · {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} of guaranteed recovery left` : "Still restorable"}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busyId === team.id} onClick={() => restore(team)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                {busyId === team.id ? "Working…" : "Restore"}
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyId === team.id} onClick={() => setPurgeTarget(team)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete permanently
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <ConfirmDeleteDialog
        open={!!purgeTarget}
        onOpenChange={(open) => { if (!open) setPurgeTarget(null); }}
        entityName={purgeTarget?.name ?? ""}
        entityType="team"
        onConfirm={purge}
        isLoading={!!purgeTarget && busyId === purgeTarget.id}
        permanent
      />
    </section>
  );
}
