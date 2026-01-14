import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, FileText, Users, Loader2, Check, Lock } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import PlayerStatsReportView from "@/components/reports/PlayerStatsReportView";

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  clubs: {
    name: string;
    logo_url: string | null;
  } | null;
}

interface GameEvent {
  id: string;
  title: string;
  event_date: string;
  opponent: string | null;
}

export default function PlayerStatsReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [reportType, setReportType] = useState<"game" | "dateRange">("game");
  const [fromCalendarOpen, setFromCalendarOpen] = useState(false);
  const [toCalendarOpen, setToCalendarOpen] = useState(false);

  const formatMinutes = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const generateSampleReportHtml = (type: 'game' | 'season') => {
    const isGame = type === 'game';
    
    const samplePlayersGame = [
      { jersey: 1, name: "James Wilson", totalMins: 2700, positions: { GK: 2700 }, subs: 0, started: true },
      { jersey: 7, name: "Alex Smith", totalMins: 1935, positions: { RW: 1200, CAM: 735 }, subs: 2, started: true },
      { jersey: 10, name: "Jordan Lee", totalMins: 1720, positions: { CAM: 1000, ST: 720 }, subs: 1, started: true },
      { jersey: 5, name: "Sam Taylor", totalMins: 1500, positions: { CB: 900, CDM: 600 }, subs: 3, started: false },
      { jersey: 11, name: "Chris Johnson", totalMins: 1350, positions: { LW: 850, LM: 500 }, subs: 2, started: true },
      { jersey: 8, name: "Ryan Brown", totalMins: 1200, positions: { CM: 800, CDM: 400 }, subs: 2, started: true },
      { jersey: 3, name: "Mike Davis", totalMins: 1100, positions: { LB: 1100 }, subs: 1, started: true },
      { jersey: 2, name: "Tom Harris", totalMins: 1050, positions: { RB: 750, CB: 300 }, subs: 2, started: true },
      { jersey: 4, name: "Ben Clark", totalMins: 900, positions: { CB: 900 }, subs: 1, started: true },
      { jersey: 6, name: "Dan White", totalMins: 850, positions: { CDM: 500, CM: 350 }, subs: 3, started: false },
      { jersey: 9, name: "Luke Martin", totalMins: 720, positions: { ST: 720 }, subs: 2, started: false },
    ];

    const samplePlayersSeason = [
      { jersey: 1, name: "James Wilson", totalMins: 48600, positions: { GK: 48600 }, subs: 0, started: true },
      { jersey: 7, name: "Alex Smith", totalMins: 42300, positions: { RW: 25200, CAM: 12600, ST: 4500 }, subs: 24, started: true },
      { jersey: 10, name: "Jordan Lee", totalMins: 39600, positions: { CAM: 21600, ST: 14400, CM: 3600 }, subs: 18, started: true },
      { jersey: 8, name: "Ryan Brown", totalMins: 37800, positions: { CM: 27000, CDM: 10800 }, subs: 22, started: true },
      { jersey: 5, name: "Sam Taylor", totalMins: 36000, positions: { CB: 28800, CDM: 7200 }, subs: 16, started: true },
      { jersey: 11, name: "Chris Johnson", totalMins: 34200, positions: { LW: 23400, LM: 10800 }, subs: 20, started: true },
      { jersey: 3, name: "Mike Davis", totalMins: 32400, positions: { LB: 32400 }, subs: 12, started: true },
      { jersey: 2, name: "Tom Harris", totalMins: 30600, positions: { RB: 25200, CB: 5400 }, subs: 14, started: true },
      { jersey: 4, name: "Ben Clark", totalMins: 28800, positions: { CB: 28800 }, subs: 10, started: true },
      { jersey: 6, name: "Dan White", totalMins: 25200, positions: { CDM: 16200, CM: 9000 }, subs: 28, started: false },
      { jersey: 9, name: "Luke Martin", totalMins: 21600, positions: { ST: 21600 }, subs: 26, started: false },
      { jersey: 12, name: "Noah Williams", totalMins: 18000, positions: { GK: 18000 }, subs: 8, started: false },
      { jersey: 14, name: "Ethan Moore", totalMins: 14400, positions: { RW: 9000, RM: 5400 }, subs: 18, started: false },
      { jersey: 15, name: "Oliver Jones", totalMins: 10800, positions: { CB: 7200, CDM: 3600 }, subs: 14, started: false },
    ];

    const samplePlayers = isGame ? samplePlayersGame : samplePlayersSeason;
    const reportTitle = isGame 
      ? "Sample United U12 vs Example City - Dec 27, 2024"
      : "Sample United U12 - Season 2024 (Mar 1 - Nov 30)";
    
    // Calculate total game time for percentage calculations
    const totalGameTime = isGame ? 2700 : 48600; // 45 min game or 18 games * 45 min each
    const totalAllPlayerMins = samplePlayers.reduce((sum, p) => sum + p.totalMins, 0);
    const totalSubs = samplePlayers.reduce((sum, p) => sum + p.subs, 0);
    const gamesPlayed = isGame ? null : 18;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sample Player Stats Report - ${isGame ? 'Game' : 'Season'}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
          .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #e5e5e5; padding-bottom: 20px; }
          .team-info { display: flex; align-items: center; gap: 16px; }
          .team-logo { width: 60px; height: 60px; border-radius: 8px; background: linear-gradient(135deg, #10b981, #059669); display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold; }
          .team-name { font-size: 24px; font-weight: bold; }
          .club-name { font-size: 14px; color: #666; }
          .ignite-branding { display: flex; align-items: center; gap: 8px; }
          .ignite-logo-box { width: 36px; height: 36px; background: #10b981; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
          .ignite-text-group { display: flex; flex-direction: column; line-height: 1.2; }
          .ignite-name { font-size: 16px; font-weight: bold; color: #1a1a1a; }
          .ignite-tagline { font-size: 10px; color: #666; }
          .report-title { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
          .sample-badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; margin-bottom: 20px; }
          .summary { display: flex; gap: 30px; margin-bottom: 30px; background: #f8f8f8; padding: 16px; border-radius: 8px; flex-wrap: wrap; }
          .summary-item { text-align: center; min-width: 80px; }
          .summary-value { font-size: 24px; font-weight: bold; color: #10b981; }
          .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f3f3f3; padding: 12px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e5e5e5; }
          td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
          tr:nth-child(even) { background: #fafafa; }
          .player-name { font-weight: 500; }
          .jersey { color: #666; font-size: 12px; }
          .position-item { display: inline-block; background: #e5e5e5; padding: 2px 6px; border-radius: 4px; margin: 2px 2px 2px 0; font-size: 11px; }
          .pct-cell { font-weight: 600; color: #10b981; }
          .footer { margin-top: 40px; text-align: center; color: #999; font-size: 12px; }
          @media print {
            body { padding: 20px; }
            .header { page-break-after: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="team-info">
            <div class="team-logo">U12</div>
            <div>
              <div class="team-name">Sample United U12</div>
              <div class="club-name">Sample Sports Club</div>
            </div>
          </div>
          <div class="ignite-branding">
            <div class="ignite-logo-box">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
              </svg>
            </div>
            <div class="ignite-text-group">
              <span class="ignite-name">Ignite</span>
              <span class="ignite-tagline">Club HQ</span>
            </div>
          </div>
        </div>

        <div class="sample-badge">SAMPLE ${isGame ? 'GAME' : 'SEASON'} REPORT</div>
        <div class="report-title">${reportTitle}</div>

        <div class="summary">
          <div class="summary-item">
            <div class="summary-value">${formatMinutes(totalGameTime)}</div>
            <div class="summary-label">${isGame ? 'Game Time' : 'Total Time'}</div>
          </div>
          ${gamesPlayed ? `
            <div class="summary-item">
              <div class="summary-value">${gamesPlayed}</div>
              <div class="summary-label">Games</div>
            </div>
          ` : ''}
          <div class="summary-item">
            <div class="summary-value">${samplePlayers.length}</div>
            <div class="summary-label">Players</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${totalSubs}</div>
            <div class="summary-label">Substitutions</div>
          </div>
          ${isGame ? `
            <div class="summary-item">
              <div class="summary-value">4-3-3</div>
              <div class="summary-label">Formation</div>
            </div>
          ` : ''}
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>Player</th>
              <th style="width: 80px;">Total</th>
              <th style="width: 70px; text-align: center;">% of Game</th>
              <th>Position Breakdown</th>
              <th style="width: 60px; text-align: center;">Subs</th>
              ${isGame ? '<th style="width: 70px; text-align: center;">Started</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${samplePlayers.map(p => {
              // Calculate percentage of game time
              const gameTimePct = ((p.totalMins / totalGameTime) * 100).toFixed(1);
              
              // Calculate position percentages (% of player's time in each position)
              const positionBreakdown = Object.entries(p.positions)
                .map(([pos, secs]) => {
                  const pct = ((secs as number) / p.totalMins * 100).toFixed(0);
                  return `<span class="position-item">${pos}: ${formatMinutes(secs as number)} (${pct}%)</span>`;
                })
                .join('');

              return `
                <tr>
                  <td class="jersey">${p.jersey}</td>
                  <td class="player-name">${p.name}</td>
                  <td>${formatMinutes(p.totalMins)}</td>
                  <td class="pct-cell" style="text-align: center;">${gameTimePct}%</td>
                  <td>${positionBreakdown}</td>
                  <td style="text-align: center;">${p.subs}</td>
                  ${isGame ? `<td style="text-align: center;">${p.started ? 'Yes' : 'No'}</td>` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div class="footer">
          Sample ${isGame ? 'Game' : 'Season'} Report - Generated on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")} • Ignite Club HQ
        </div>
      </body>
      </html>
    `;
  };

  const handleDownloadSampleReport = (type: 'game' | 'season') => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(generateSampleReportHtml(type));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };

  // Fetch teams where user is admin/coach
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["admin-coach-teams", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, role")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null);

      if (!roles || roles.length === 0) return [];

      const teamIds = [...new Set(roles.map((r) => r.team_id))];

      const { data: teams } = await supabase
        .from("teams")
        .select("id, name, logo_url, clubs(name, logo_url)")
        .in("id", teamIds);

      return (teams as Team[]) || [];
    },
    enabled: !!user,
  });

  // Fetch game events for selected team that have stats
  const { data: gameEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["team-game-events", selectedTeamId],
    queryFn: async () => {
      // Get events that have game summaries
      const { data: summaries } = await supabase
        .from("game_summaries")
        .select("event_id")
        .eq("team_id", selectedTeamId);

      if (!summaries || summaries.length === 0) return [];

      const eventIds = summaries.map((s) => s.event_id);

      const { data: events } = await supabase
        .from("events")
        .select("id, title, event_date, opponent")
        .in("id", eventIds)
        .order("event_date", { ascending: false });

      return (events as GameEvent[]) || [];
    },
    enabled: !!selectedTeamId,
  });

  // Check if user has Pro Football access via team or club subscription
  const { data: hasProFootball, isLoading: proFootballLoading } = useQuery({
    queryKey: ["pro-football-access", user?.id],
    queryFn: async () => {
      // Check team subscriptions
      const { data: teamSubs } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro_football")
        .eq("is_pro_football", true);

      if (teamSubs && teamSubs.length > 0) {
        // Check if user is a member of any pro football team
        const { data: userTeamRoles } = await supabase
          .from("user_roles")
          .select("team_id")
          .eq("user_id", user!.id)
          .not("team_id", "is", null);

        if (userTeamRoles) {
          const userTeamIds = userTeamRoles.map((r) => r.team_id);
          const hasTeamAccess = teamSubs.some((s) => userTeamIds.includes(s.team_id));
          if (hasTeamAccess) return true;
        }
      }

      // Check club subscriptions
      const { data: clubSubs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro_football")
        .eq("is_pro_football", true);

      if (clubSubs && clubSubs.length > 0) {
        // Check if user is a member of any pro football club
        const { data: userClubRoles } = await supabase
          .from("user_roles")
          .select("club_id")
          .eq("user_id", user!.id)
          .not("club_id", "is", null);

        if (userClubRoles) {
          const userClubIds = userClubRoles.map((r) => r.club_id);
          const hasClubAccess = clubSubs.some((s) => userClubIds.includes(s.club_id));
          if (hasClubAccess) return true;
        }
      }

      return false;
    },
    enabled: !!user,
  });

  // Select first team by default
  if (teams && teams.length > 0 && !selectedTeamId) {
    setSelectedTeamId(teams[0].id);
  }

  const selectedTeam = teams?.find((t) => t.id === selectedTeamId);
  const selectedEvent = gameEvents?.find((e) => e.id === selectedEventId);

  if (teamsLoading || proFootballLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>You need to be a team admin or coach to access player reports.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check for Pro Football subscription
  if (!hasProFootball) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Pro Football Feature</h2>
              <p className="text-sm text-muted-foreground">
                Player Stats Reports are available with a Pro Football subscription.
              </p>
            </div>
            <Button onClick={() => navigate("/profile")} variant="outline">
              View Subscription Options
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
            Player Stats Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Download reports showing player minutes and positions
          </p>
        </div>
      </div>

      {/* Sample Report Downloads */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <p className="font-medium text-sm">Sample Reports</p>
          <p className="text-xs text-muted-foreground">See what the reports look like</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" onClick={() => handleDownloadSampleReport('game')} className="gap-2 flex-1">
              <FileText className="h-4 w-4" />
              Single Game
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleDownloadSampleReport('season')} className="gap-2 flex-1">
              <Calendar className="h-4 w-4" />
              Full Season
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Team Selection - Card-based for mobile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Team</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {teams.length === 1 ? (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="flex-1">
                <p className="font-medium">{teams[0].name}</p>
                {teams[0].clubs?.name && (
                  <p className="text-xs text-muted-foreground">{teams[0].clubs.name}</p>
                )}
              </div>
              <Check className="h-4 w-4 text-primary" />
            </div>
          ) : (
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-2">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => {
                      setSelectedTeamId(team.id);
                      setSelectedEventId("");
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                      selectedTeamId === team.id
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-muted hover:bg-muted/80"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{team.name}</p>
                      {team.clubs?.name && (
                        <p className="text-xs text-muted-foreground truncate">{team.clubs.name}</p>
                      )}
                    </div>
                    {selectedTeamId === team.id && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {selectedTeamId && (
        <Tabs value={reportType} onValueChange={(v) => setReportType(v as "game" | "dateRange")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="game" className="text-sm">By Game</TabsTrigger>
            <TabsTrigger value="dateRange" className="text-sm">By Date Range</TabsTrigger>
          </TabsList>

          <TabsContent value="game" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Game</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {eventsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : gameEvents && gameEvents.length > 0 ? (
                  <ScrollArea className="max-h-[250px]">
                    <div className="space-y-2">
                      {gameEvents.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => setSelectedEventId(event.id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                            selectedEventId === event.id
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {event.opponent ? `vs ${event.opponent}` : event.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(event.event_date), "EEE, MMM d, yyyy")}
                            </p>
                          </div>
                          {selectedEventId === event.id && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No games with recorded stats found for this team.
                  </p>
                )}
              </CardContent>
            </Card>

            {selectedEventId && selectedTeam && (
              <PlayerStatsReportView
                teamId={selectedTeamId}
                teamName={selectedTeam.name}
                teamLogoUrl={selectedTeam.logo_url}
                clubName={selectedTeam.clubs?.name}
                clubLogoUrl={selectedTeam.clubs?.logo_url}
                eventId={selectedEventId}
                event={selectedEvent}
              />
            )}
          </TabsContent>

          <TabsContent value="dateRange" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Date Range</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex flex-col gap-3">
                  {/* From Date */}
                  {isMobile ? (
                    <>
                      <button
                        onClick={() => setFromCalendarOpen(true)}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                          "bg-muted hover:bg-muted/80"
                        )}
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">From</p>
                          <p className="font-medium">{format(dateRange.from, "EEE, MMM d, yyyy")}</p>
                        </div>
                      </button>
                      <Drawer open={fromCalendarOpen} onOpenChange={setFromCalendarOpen}>
                        <DrawerContent>
                          <DrawerHeader>
                            <DrawerTitle>Select Start Date</DrawerTitle>
                          </DrawerHeader>
                          <div className="flex justify-center pb-8 px-4">
                            <CalendarComponent
                              mode="single"
                              selected={dateRange.from}
                              onSelect={(date) => {
                                if (date) {
                                  setDateRange((prev) => ({ ...prev, from: date }));
                                  setFromCalendarOpen(false);
                                }
                              }}
                              className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                            />
                          </div>
                        </DrawerContent>
                      </Drawer>
                    </>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                            "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                            <Calendar className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">From</p>
                            <p className="font-medium">{format(dateRange.from, "EEE, MMM d, yyyy")}</p>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-50 bg-popover" align="center" side="bottom" sideOffset={8}>
                        <CalendarComponent
                          mode="single"
                          selected={dateRange.from}
                          onSelect={(date) => date && setDateRange((prev) => ({ ...prev, from: date }))}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                  
                  {/* To Date */}
                  {isMobile ? (
                    <>
                      <button
                        onClick={() => setToCalendarOpen(true)}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                          "bg-muted hover:bg-muted/80"
                        )}
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">To</p>
                          <p className="font-medium">{format(dateRange.to, "EEE, MMM d, yyyy")}</p>
                        </div>
                      </button>
                      <Drawer open={toCalendarOpen} onOpenChange={setToCalendarOpen}>
                        <DrawerContent>
                          <DrawerHeader>
                            <DrawerTitle>Select End Date</DrawerTitle>
                          </DrawerHeader>
                          <div className="flex justify-center pb-8 px-4">
                            <CalendarComponent
                              mode="single"
                              selected={dateRange.to}
                              onSelect={(date) => {
                                if (date) {
                                  setDateRange((prev) => ({ ...prev, to: date }));
                                  setToCalendarOpen(false);
                                }
                              }}
                              className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                            />
                          </div>
                        </DrawerContent>
                      </Drawer>
                    </>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                            "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                            <Calendar className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">To</p>
                            <p className="font-medium">{format(dateRange.to, "EEE, MMM d, yyyy")}</p>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-50 bg-popover" align="center" side="bottom" sideOffset={8}>
                        <CalendarComponent
                          mode="single"
                          selected={dateRange.to}
                          onSelect={(date) => date && setDateRange((prev) => ({ ...prev, to: date }))}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedTeam && (
              <PlayerStatsReportView
                teamId={selectedTeamId}
                teamName={selectedTeam.name}
                teamLogoUrl={selectedTeam.logo_url}
                clubName={selectedTeam.clubs?.name}
                clubLogoUrl={selectedTeam.clubs?.logo_url}
                dateRange={dateRange}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
