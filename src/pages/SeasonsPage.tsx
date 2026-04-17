import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Archive, CheckCircle2, Clock, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { useClubSeasons, type Season, type SeasonStatus } from "@/hooks/useClubSeasons";
import { StartNewSeasonWizard } from "@/components/seasons/StartNewSeasonWizard";
import { format } from "date-fns";

const STATUS_META: Record<SeasonStatus, { label: string; icon: typeof Clock; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "Draft", icon: Clock, variant: "outline" },
  active: { label: "Active", icon: CheckCircle2, variant: "default" },
  closed: { label: "Closed", icon: Lock, variant: "secondary" },
  archived: { label: "Archived", icon: Archive, variant: "secondary" },
};

export default function SeasonsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: club, isLoading: clubLoading } = useQuery({
    queryKey: ["club-basic", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, current_season_id")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: isClubAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-club-admin-for-seasons", clubId, user?.id],
    queryFn: async () => {
      if (!user?.id || !clubId) return false;
      const [appAdmin, clubAdmin] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "app_admin").maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id).eq("club_id", clubId).eq("role", "club_admin").maybeSingle(),
      ]);
      return !!appAdmin.data || !!clubAdmin.data;
    },
    enabled: !!user?.id && !!clubId,
  });

  const { data: seasons = [], isLoading: seasonsLoading, refetch } = useClubSeasons(clubId);

  const seasonIds = useMemo(() => seasons.map((s) => s.id), [seasons]);

  const { data: teamCounts = {} } = useQuery({
    queryKey: ["season-team-counts", clubId, seasonIds.join(",")],
    queryFn: async (): Promise<Record<string, number>> => {
      if (seasonIds.length === 0) return {};
      const { data, error } = await supabase
        .from("teams")
        .select("season_id")
        .in("season_id", seasonIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((row: any) => {
        if (row.season_id) counts[row.season_id] = (counts[row.season_id] ?? 0) + 1;
      });
      return counts;
    },
    enabled: seasonIds.length > 0,
  });

  const grouped = useMemo(() => {
    const active: Season[] = [];
    const draft: Season[] = [];
    const past: Season[] = [];
    seasons.forEach((s) => {
      if (s.status === "active") active.push(s);
      else if (s.status === "draft") draft.push(s);
      else past.push(s);
    });
    return { active, draft, past };
  }, [seasons]);

  if (clubLoading || adminLoading || seasonsLoading) return <PageLoading />;

  if (!isClubAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Seasons</h1>
        </div>
        <p className="text-muted-foreground p-4">Only club admins can manage seasons.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">Seasons</h1>
          <p className="text-sm text-muted-foreground truncate">{club?.name}</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Start new season
        </Button>
      </div>

      {grouped.active.length > 0 && (
        <SeasonGroup title="Current season" seasons={grouped.active} teamCounts={teamCounts} onClick={(s) => navigate(`/clubs/${clubId}/seasons/${s.id}`)} />
      )}

      {grouped.draft.length > 0 && (
        <SeasonGroup title="Draft seasons" seasons={grouped.draft} teamCounts={teamCounts} onClick={(s) => navigate(`/clubs/${clubId}/seasons/${s.id}`)} />
      )}

      {grouped.past.length > 0 && (
        <SeasonGroup title="Past seasons" seasons={grouped.past} teamCounts={teamCounts} onClick={(s) => navigate(`/clubs/${clubId}/seasons/${s.id}`)} />
      )}

      {seasons.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No seasons yet. Start your first one.
          </CardContent>
        </Card>
      )}

      {clubId && (
        <StartNewSeasonWizard
          clubId={clubId}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          currentSeason={grouped.active[0]}
          onComplete={() => {
            setWizardOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function SeasonGroup({
  title,
  seasons,
  teamCounts,
  onClick,
}: {
  title: string;
  seasons: Season[];
  teamCounts: Record<string, number>;
  onClick: (s: Season) => void;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground px-1">{title}</h2>
      {seasons.map((s) => {
        const meta = STATUS_META[s.status];
        const Icon = meta.icon;
        const count = teamCounts[s.id] ?? 0;
        return (
          <Card key={s.id} className="cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => onClick(s)}>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base truncate">{s.name}</CardTitle>
                <CardDescription className="text-xs flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {count} team{count === 1 ? "" : "s"}
                  </span>
                  {s.start_date && (
                    <span>
                      · {format(new Date(s.start_date), "MMM yyyy")}
                      {s.end_date ? ` – ${format(new Date(s.end_date), "MMM yyyy")}` : ""}
                    </span>
                  )}
                </CardDescription>
              </div>
              <Badge variant={meta.variant} className="gap-1 flex-shrink-0">
                <Icon className="h-3 w-3" />
                {meta.label}
              </Badge>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}
