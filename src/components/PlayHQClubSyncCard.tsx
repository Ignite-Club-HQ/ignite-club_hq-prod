import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trophy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  clubId: string;
}

interface ClubRow {
  playhq_tenant: string | null;
  playhq_org_id: string | null;
}

export function PlayHQClubSyncCard({ clubId }: Props) {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: club } = useQuery({
    queryKey: ["club-playhq-link", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("playhq_tenant, playhq_org_id")
        .eq("id", clubId)
        .single();
      if (error) throw error;
      return data as ClubRow;
    },
  });

  const [tenant, setTenant] = useState("");
  const [orgId, setOrgId] = useState("");

  // Keep local inputs in sync with loaded data.
  const tenantValue = tenant || club?.playhq_tenant || "";
  const orgValue = orgId || club?.playhq_org_id || "";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("clubs")
        .update({
          playhq_tenant: tenantValue.trim() || null,
          playhq_org_id: orgValue.trim() || null,
        })
        .eq("id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("PlayHQ details saved");
      qc.invalidateQueries({ queryKey: ["club-playhq-link", clubId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("playhq-sync-club", {
        body: { club_id: clubId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = data as {
        teams_seen: number;
        teams_linked: number;
        teams_created: number;
        events_created: number;
        events_updated: number;
      };
      toast.success(
        `Synced ${r.teams_seen} PlayHQ teams · ${r.teams_created} new, ${r.teams_linked} linked · ${r.events_created} new events`,
      );
      qc.invalidateQueries({ queryKey: ["teams"] });
    } catch (e: any) {
      toast.error(e.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const canSync = !!(club?.playhq_tenant && club?.playhq_org_id);

  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-500" />
          <div className="font-medium text-sm">PlayHQ Club Sync</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Link this club to your PlayHQ organisation. Sync will pull every PlayHQ
          team, create or link an Ignite team for each, and import their fixtures
          as match events.
        </p>

        <div className="space-y-2">
          <Label className="text-xs">PlayHQ tenant</Label>
          <Input
            placeholder="e.g. bv, netball-au"
            value={tenantValue}
            onChange={(e) => setTenant(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">PlayHQ organisation ID</Label>
          <Input
            placeholder="UUID from your PlayHQ org page"
            value={orgValue}
            onChange={(e) => setOrgId(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            Save
          </Button>
          <Button onClick={runSync} disabled={!canSync || syncing} className="flex-1">
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync club from PlayHQ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
