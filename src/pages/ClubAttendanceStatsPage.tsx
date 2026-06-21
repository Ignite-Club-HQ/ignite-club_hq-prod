import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AttendanceStatsPage from "./AttendanceStatsPage";

export default function ClubAttendanceStatsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  // Admin gate: club_admin for this club OR app_admin
  const { data: isAdmin, isLoading: loadingAdmin } = useQuery({
    queryKey: ["is-club-admin-attendance", user?.id, clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id")
        .eq("user_id", user!.id);
      if (!data) return false;
      if (data.some((r) => r.role === "app_admin")) return true;
      if (data.some((r) => r.role === "club_admin" && r.club_id === clubId)) return true;
      return false;
    },
    enabled: !!user && !!clubId,
  });

  const { data: club, isLoading: clubLoading } = useQuery({
    queryKey: ["club-attendance-meta", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["club-attendance-teams", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_archived")
        .eq("club_id", clubId!)
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clubId,
  });

  const teamOptions = useMemo(() => teams, [teams]);

  if (loadingAdmin || clubLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Attendance Stats</h1>
        </div>
        <Card className="max-w-lg mx-auto">
          <CardContent className="py-8 text-center space-y-3">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Only club admins can view club-wide attendance statistics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Attendance Stats</h1>
          <p className="text-sm text-muted-foreground">{club?.name ?? "Club"}</p>
        </div>
        <BarChart3 className="h-8 w-8 text-primary" />
      </div>

      {/* Team selector */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <label className="text-sm font-medium">Team</label>
          <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
            <SelectTrigger>
              <SelectValue
                placeholder={teamsLoading ? "Loading teams…" : "Select a team"}
              />
            </SelectTrigger>
            <SelectContent>
              {teamOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teamOptions.length === 0 && !teamsLoading && (
            <p className="text-xs text-muted-foreground">No teams in this club.</p>
          )}
        </CardContent>
      </Card>

      {/* Embedded per-team stats */}
      {selectedTeamId ? (
        <AttendanceStatsPage
          key={selectedTeamId}
          teamIdOverride={selectedTeamId}
          embedded
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select a team above to view attendance stats.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
