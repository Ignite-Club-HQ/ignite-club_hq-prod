import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, Users, UserPlus, ClipboardList, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  useEoiSubmissions,
  useEoiStats,
  useUpdateEoiStatus,
  useDeleteEoi,
  type EoiStatus,
} from "@/hooks/useEoiAdmin";
import { EOI_STATUS_LABELS, calculateAgeGroup, buildPublicEoiUrl } from "@/lib/eoiUtils";
import { EoiTeamSuggestions } from "@/components/eoi/EoiTeamSuggestions";

export default function EoiAdminPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const [seasonId, setSeasonId] = useState<string | "all">("all");
  const [statusFilter, setStatusFilter] = useState<EoiStatus | "all">("all");
  const [search, setSearch] = useState("");

  const { data: club } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: seasons = [] } = useQuery({
    queryKey: ["club-seasons-eoi", clubId],
    queryFn: async () => {
      if (!clubId) return [];
      const { data, error } = await supabase
        .from("seasons")
        .select("id, name, eoi_enabled, eoi_slug")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!clubId,
  });

  const activeSeasonId = seasonId === "all" ? null : seasonId;
  const { data: submissions = [], isLoading } = useEoiSubmissions(clubId, activeSeasonId);
  const { data: stats } = useEoiStats(clubId, activeSeasonId);

  const updateStatus = useUpdateEoiStatus();
  const deleteEoi = useDeleteEoi();

  const filtered = useMemo(() => {
    let rows = submissions;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.player_name.toLowerCase().includes(q) ||
          r.parent_name.toLowerCase().includes(q) ||
          r.parent_email.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [submissions, statusFilter, search]);

  const teamsMap = useMemo(() => {
    const m = new Map<string, string>();
    return m;
  }, []);

  if (!clubId) return null;
  if (isLoading && !submissions.length) return <PageLoading />;

  const selectedSeason = seasons.find((s) => s.id === seasonId);
  const publicUrl =
    selectedSeason?.eoi_enabled && selectedSeason?.eoi_slug && club
      ? buildPublicEoiUrl(club.name, selectedSeason.eoi_slug)
      : null;

  return (
    <div className="py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/clubs/${clubId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            EOIs
          </h1>
          <p className="text-sm text-muted-foreground truncate">{club?.name}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select value={seasonId} onValueChange={(v) => setSeasonId(v as any)}>
          <SelectTrigger>
            <SelectValue placeholder="All seasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All seasons</SelectItem>
            {seasons.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {s.eoi_enabled ? " · live" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(EOI_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {publicUrl && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Public EOI link</p>
              <code className="text-xs truncate block text-foreground">{publicUrl}</code>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast.success("Link copied");
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile icon={<Users className="h-4 w-4" />} label="Total" value={Number(stats.total ?? 0)} />
          <StatTile label="Submitted" value={Number(stats.submitted ?? 0)} />
          <StatTile label="Allocated" value={Number(stats.allocated ?? 0)} />
          <StatTile
            icon={<UserPlus className="h-4 w-4" />}
            label="New players"
            value={Number(stats.new_players ?? 0)}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by player or parent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Submissions list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {submissions.length === 0
                ? "No EOI submissions yet."
                : "No EOIs match your filters."}
            </CardContent>
          </Card>
        )}

        {filtered.map((r) => {
          const seasonName = seasons.find((s) => s.id === r.season_id)?.name ?? "—";
          const ageGroup = r.age_group ?? calculateAgeGroup(r.player_dob);
          return (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{r.player_name}</p>
                      {ageGroup && (
                        <Badge variant="outline" className="text-xs">
                          {ageGroup}
                        </Badge>
                      )}
                      {r.returning_player && (
                        <Badge variant="secondary" className="text-xs">
                          Returning
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.parent_name} · {r.parent_email}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {seasonName} ·{" "}
                      {r.submitted_at
                        ? format(new Date(r.submitted_at), "MMM d")
                        : "—"}{" "}
                      · via {r.source}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Badge
                        variant={
                          r.status === "registered" || r.status === "confirmed"
                            ? "default"
                            : r.status === "withdrawn"
                              ? "destructive"
                              : "secondary"
                        }
                        className="cursor-pointer capitalize"
                      >
                        {EOI_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Set status</DropdownMenuLabel>
                      {(Object.keys(EOI_STATUS_LABELS) as EoiStatus[]).map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => updateStatus.mutate({ id: r.id, status: s })}
                        >
                          {EOI_STATUS_LABELS[s]}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Delete this submission?")) deleteEoi.mutate(r.id);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {(r.preferred_teammates ||
                  r.preferred_position ||
                  r.skill_level ||
                  (r.training_days && r.training_days.length > 0) ||
                  (r.game_days && r.game_days.length > 0)) && (
                  <div className="mt-2 pt-2 border-t text-xs text-muted-foreground space-y-0.5">
                    {r.preferred_teammates && (
                      <p>
                        <span className="font-medium">Teammates:</span>{" "}
                        {r.preferred_teammates}
                      </p>
                    )}
                    {r.preferred_position && (
                      <p>
                        <span className="font-medium">Position:</span>{" "}
                        {r.preferred_position}
                      </p>
                    )}
                    {r.skill_level && (
                      <p>
                        <span className="font-medium">Skill:</span> {r.skill_level}/5
                      </p>
                    )}
                    {r.training_days && r.training_days.length > 0 && (
                      <p>
                        <span className="font-medium">Training:</span>{" "}
                        {r.training_days.join(", ")}
                      </p>
                    )}
                    {r.game_days && r.game_days.length > 0 && (
                      <p>
                        <span className="font-medium">Games:</span>{" "}
                        {r.game_days.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
