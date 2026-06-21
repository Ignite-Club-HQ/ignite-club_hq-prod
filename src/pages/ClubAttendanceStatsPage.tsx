import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Lock, ChevronRight, Calendar, Filter } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth, parseISO, isPast } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AttendanceStatsPage from "./AttendanceStatsPage";

const ALL_TEAMS = "__all__";

export default function ClubAttendanceStatsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedTeamId, setSelectedTeamId] = useState<string>(ALL_TEAMS);

  // Default last 3 months for the club-wide view (user-adjustable)
  const [startDate, setStartDate] = useState<Date>(() => startOfMonth(subMonths(new Date(), 3)));
  const [endDate, setEndDate] = useState<Date>(() => endOfMonth(new Date()));

  // Admin gate
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

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);

  // Club-wide events (game + training, past, in range)
  const { data: clubEvents = [], isLoading: clubEventsLoading } = useQuery({
    queryKey: ["club-events-attendance", clubId, teamIds, startDate, endDate],
    queryFn: async () => {
      if (teamIds.length === 0) return [];
      const { data, error } = await supabase
        .from("events")
        .select("id, team_id, event_date, type, is_cancelled")
        .in("team_id", teamIds)
        .eq("is_cancelled", false)
        .in("type", ["game", "training"])
        .gte("event_date", startDate.toISOString())
        .lte("event_date", endDate.toISOString());
      if (error) throw error;
      return (data || []).filter((e) => isPast(parseISO(e.event_date)));
    },
    enabled: selectedTeamId === ALL_TEAMS && teamIds.length > 0,
  });

  const { data: clubRsvps = [], isLoading: clubRsvpsLoading } = useQuery({
    queryKey: ["club-rsvps-attendance", clubId, clubEvents.map((e) => e.id)],
    queryFn: async () => {
      if (clubEvents.length === 0) return [];
      const eventIds = clubEvents.map((e) => e.id);
      // Chunk to stay below URL size limits
      const chunkSize = 200;
      const results: any[] = [];
      for (let i = 0; i < eventIds.length; i += chunkSize) {
        const chunk = eventIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("rsvps")
          .select("event_id, status")
          .in("event_id", chunk);
        if (error) throw error;
        results.push(...(data || []));
      }
      return results;
    },
    enabled: selectedTeamId === ALL_TEAMS && clubEvents.length > 0,
  });

  // Per-team aggregates
  const teamAggregates = useMemo(() => {
    const eventsByTeam = new Map<string, string[]>(); // teamId -> eventIds
    clubEvents.forEach((e) => {
      const arr = eventsByTeam.get(e.team_id) || [];
      arr.push(e.id);
      eventsByTeam.set(e.team_id, arr);
    });

    const rsvpByEvent = new Map<string, { going: number; total: number }>();
    clubRsvps.forEach((r: any) => {
      const cur = rsvpByEvent.get(r.event_id) || { going: 0, total: 0 };
      cur.total += 1;
      if (r.status === "going") cur.going += 1;
      rsvpByEvent.set(r.event_id, cur);
    });

    return teams.map((t) => {
      const ids = eventsByTeam.get(t.id) || [];
      let going = 0;
      let total = 0;
      ids.forEach((id) => {
        const v = rsvpByEvent.get(id);
        if (v) {
          going += v.going;
          total += v.total;
        }
      });
      const rate = total > 0 ? Math.round((going / total) * 100) : 0;
      return { id: t.id, name: t.name, events: ids.length, going, total, rate };
    }).sort((a, b) => b.rate - a.rate);
  }, [teams, clubEvents, clubRsvps]);

  const clubTotals = useMemo(() => {
    const totalEvents = clubEvents.length;
    const totalGoing = clubRsvps.filter((r: any) => r.status === "going").length;
    const totalResponses = clubRsvps.length;
    const avgRate = totalResponses > 0 ? Math.round((totalGoing / totalResponses) * 100) : 0;
    return { totalEvents, totalGoing, totalResponses, avgRate, totalTeams: teams.length };
  }, [clubEvents, clubRsvps, teams]);

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

  const aggregateLoading = clubEventsLoading || clubRsvpsLoading || teamsLoading;

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
          <label className="text-sm font-medium">View</label>
          <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
            <SelectTrigger>
              <SelectValue placeholder={teamsLoading ? "Loading teams…" : "Select"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TEAMS}>Overall Club (all teams)</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teams.length === 0 && !teamsLoading && (
            <p className="text-xs text-muted-foreground">No teams in this club.</p>
          )}
        </CardContent>
      </Card>

      {selectedTeamId !== ALL_TEAMS ? (
        <AttendanceStatsPage key={selectedTeamId} teamIdOverride={selectedTeamId} embedded />
      ) : (
        <>
          {/* Date range filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Time Period
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <Calendar className="mr-2 h-4 w-4" />
                        {format(startDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={startDate}
                        onSelect={(date) => date && setStartDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <Calendar className="mr-2 h-4 w-4" />
                        {format(endDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={endDate}
                        onSelect={(date) => date && setEndDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Showing games &amp; training from {format(startDate, "dd MMM yyyy")} to{" "}
                {format(endDate, "dd MMM yyyy")}. Switch to a team for a full per-player breakdown.
              </p>
            </CardContent>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{clubTotals.totalTeams}</p>
                <p className="text-sm text-muted-foreground">Teams</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{clubTotals.totalEvents}</p>
                <p className="text-sm text-muted-foreground">Sessions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-emerald-500">{clubTotals.avgRate}%</p>
                <p className="text-sm text-muted-foreground">Avg Attendance</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{clubTotals.totalResponses}</p>
                <p className="text-sm text-muted-foreground">Responses</p>
              </CardContent>
            </Card>
          </div>

          {/* Per team breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Team Breakdown</CardTitle>
              <CardDescription>
                Attendance rate = "Going" responses ÷ total responses on games &amp; training.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {aggregateLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : teamAggregates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No data for the selected period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center w-20">Sessions</TableHead>
                        <TableHead className="w-40">Rate</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamAggregates.map((t) => (
                        <TableRow
                          key={t.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedTeamId(t.id)}
                        >
                          <TableCell className="font-medium text-sm">{t.name}</TableCell>
                          <TableCell className="text-center text-sm">{t.events}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={t.rate} className="h-2 flex-1" />
                              <span className="text-sm font-medium w-10 text-right">
                                {t.rate}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
