import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Flame } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PlayerStatsReportViewProps {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  clubName?: string | null;
  clubLogoUrl?: string | null;
  eventId?: string;
  event?: {
    id: string;
    title: string;
    event_date: string;
    opponent: string | null;
  };
  dateRange?: {
    from: Date;
    to: Date;
  };
}

interface PlayerStat {
  id: string;
  user_id: string | null;
  fill_in_player_name: string | null;
  jersey_number: number | null;
  minutes_played: number;
  positions_played: string[];
  position_minutes: Record<string, number> | null;
  substitutions_count: number;
  started_on_pitch: boolean;
  goals_scored: number;
  profiles?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export default function PlayerStatsReportView({
  teamId,
  teamName,
  teamLogoUrl,
  clubName,
  clubLogoUrl,
  eventId,
  event,
  dateRange,
}: PlayerStatsReportViewProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Fetch player stats
  const { data: playerStats, isLoading } = useQuery({
    queryKey: ["player-stats-report", teamId, eventId, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("game_player_stats")
        .select(`
          id,
          user_id,
          fill_in_player_name,
          jersey_number,
          minutes_played,
          positions_played,
          position_minutes,
          substitutions_count,
          started_on_pitch,
          goals_scored,
          profiles:user_id(display_name, avatar_url)
        `)
        .eq("team_id", teamId);

      if (eventId) {
        query = query.eq("event_id", eventId);
      } else if (dateRange) {
        // Get events in date range first
        const { data: events } = await supabase
          .from("events")
          .select("id")
          .eq("team_id", teamId)
          .gte("event_date", dateRange.from.toISOString())
          .lte("event_date", dateRange.to.toISOString());

        if (!events || events.length === 0) return [];

        const eventIds = events.map((e) => e.id);
        query = query.in("event_id", eventIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Aggregate stats if date range
      if (dateRange && data) {
        const aggregated = new Map<string, PlayerStat>();

        data.forEach((stat: any) => {
          const key = stat.user_id || stat.fill_in_player_name || stat.id;
          const existing = aggregated.get(key);

          if (existing) {
            existing.minutes_played += stat.minutes_played;
            existing.substitutions_count += stat.substitutions_count;
            existing.goals_scored += stat.goals_scored || 0;
            stat.positions_played.forEach((pos: string) => {
              if (!existing.positions_played.includes(pos)) {
                existing.positions_played.push(pos);
              }
            });
            // Aggregate position minutes
            if (stat.position_minutes) {
              if (!existing.position_minutes) {
                existing.position_minutes = {};
              }
              Object.entries(stat.position_minutes as Record<string, number>).forEach(([pos, mins]) => {
                existing.position_minutes![pos] = (existing.position_minutes![pos] || 0) + mins;
              });
            }
          } else {
            aggregated.set(key, {
              ...stat,
              positions_played: [...stat.positions_played],
              position_minutes: stat.position_minutes ? { ...stat.position_minutes } : null,
              goals_scored: stat.goals_scored || 0,
            });
          }
        });

        return Array.from(aggregated.values());
      }

      return data as PlayerStat[];
    },
    enabled: !!teamId && (!!eventId || !!dateRange),
  });

  // Fetch game summary for single game
  const { data: gameSummary } = useQuery({
    queryKey: ["game-summary-report", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_summaries")
        .select("*")
        .eq("event_id", eventId!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!eventId,
  });

  const formatMinutes = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDownload = async () => {
    if (!reportRef.current) return;

    try {
      // Create a printable version
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast({
          title: "Popup blocked",
          description: "Please allow popups to download the report.",
          variant: "destructive",
        });
        return;
      }

      const logoUrl = teamLogoUrl || clubLogoUrl;
      const reportTitle = eventId && event
        ? `${teamName} vs ${event.opponent || "Unknown"} - ${format(new Date(event.event_date), "MMM d, yyyy")}`
        : `${teamName} Stats - ${format(dateRange!.from, "MMM d")} to ${format(dateRange!.to, "MMM d, yyyy")}`;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
            .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #e5e5e5; padding-bottom: 20px; }
            .team-info { display: flex; align-items: center; gap: 16px; }
            .team-logo { width: 60px; height: 60px; border-radius: 8px; object-fit: cover; }
            .team-name { font-size: 24px; font-weight: bold; }
            .club-name { font-size: 14px; color: #666; }
            .ignite-branding { display: flex; align-items: center; gap: 8px; }
            .ignite-logo { color: #f97316; }
            .ignite-text { font-size: 14px; color: #666; }
            .report-title { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
            .summary { display: flex; gap: 30px; margin-bottom: 30px; background: #f8f8f8; padding: 16px; border-radius: 8px; }
            .summary-item { text-align: center; }
            .summary-value { font-size: 24px; font-weight: bold; color: #f97316; }
            .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f3f3f3; padding: 12px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e5e5e5; }
            td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; }
            tr:nth-child(even) { background: #fafafa; }
            .player-name { font-weight: 500; }
            .jersey { color: #666; font-size: 12px; }
            .position-badge { display: inline-block; background: #e5e5e5; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin: 2px; }
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
              ${logoUrl ? `<img src="${logoUrl}" alt="${teamName}" class="team-logo" />` : ""}
              <div>
                <div class="team-name">${teamName}</div>
                ${clubName ? `<div class="club-name">${clubName}</div>` : ""}
              </div>
            </div>
            <div class="ignite-branding">
              <svg class="ignite-logo" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span class="ignite-text">Powered by Ignite</span>
            </div>
          </div>

          <div class="report-title">${reportTitle}</div>

          ${gameSummary ? `
            <div class="summary">
              <div class="summary-item">
                <div class="summary-value">${formatMinutes(gameSummary.total_game_time)}</div>
                <div class="summary-label">Total Time</div>
              </div>
              <div class="summary-item">
                <div class="summary-value">${playerStats?.length || 0}</div>
                <div class="summary-label">Players</div>
              </div>
              <div class="summary-item">
                <div class="summary-value">${gameSummary.total_substitutions}</div>
                <div class="summary-label">Substitutions</div>
              </div>
              ${gameSummary.formation_used ? `
                <div class="summary-item">
                  <div class="summary-value">${gameSummary.formation_used}</div>
                  <div class="summary-label">Formation</div>
                </div>
              ` : ""}
            </div>
          ` : ""}

          <table>
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Player</th>
                <th style="width: 60px; text-align: center;">Goals</th>
                <th style="width: 80px;">Total</th>
                <th>Minutes by Position</th>
                <th style="width: 60px; text-align: center;">Subs</th>
                <th style="width: 70px; text-align: center;">Started</th>
              </tr>
            </thead>
            <tbody>
              ${(playerStats || [])
                .sort((a, b) => b.minutes_played - a.minutes_played)
                .map((stat) => {
                  const positionMinsHtml = stat.position_minutes && Object.keys(stat.position_minutes).length > 0
                    ? Object.entries(stat.position_minutes)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([pos, secs]) => `<span class="position-badge">${pos}: ${formatMinutes(secs as number)}</span>`)
                        .join("")
                    : stat.positions_played.map((p) => `<span class="position-badge">${p}</span>`).join("");
                  
                  return `
                    <tr>
                      <td class="jersey">${stat.jersey_number || "-"}</td>
                      <td class="player-name">${stat.fill_in_player_name || stat.profiles?.display_name || "Unknown"}</td>
                      <td style="text-align: center; font-weight: ${stat.goals_scored > 0 ? 'bold' : 'normal'}; color: ${stat.goals_scored > 0 ? '#f97316' : 'inherit'};">${stat.goals_scored || 0}</td>
                      <td>${formatMinutes(stat.minutes_played)}</td>
                      <td>${positionMinsHtml}</td>
                      <td style="text-align: center;">${stat.substitutions_count}</td>
                      <td style="text-align: center;">${stat.started_on_pitch ? "Yes" : "No"}</td>
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>

          <div class="footer">
            Generated on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")} • Ignite Club HQ
          </div>
        </body>
        </html>
      `);

      printWindow.document.close();
      printWindow.focus();

      // Wait for images to load
      setTimeout(() => {
        printWindow.print();
      }, 500);
    } catch (error) {
      console.error("Failed to generate report:", error);
      toast({
        title: "Failed to generate report",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!playerStats || playerStats.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No player statistics found for this selection.
        </CardContent>
      </Card>
    );
  }

  const sortedStats = [...playerStats].sort((a, b) => b.minutes_played - a.minutes_played);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          Player Statistics
        </CardTitle>
        <Button onClick={handleDownload} size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          Download Report
        </Button>
      </CardHeader>
      <CardContent ref={reportRef}>
        {/* Summary Stats */}
        {gameSummary && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {formatMinutes(gameSummary.total_game_time)}
              </div>
              <div className="text-xs text-muted-foreground">Total Time</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {playerStats.length}
              </div>
              <div className="text-xs text-muted-foreground">Players</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {gameSummary.total_substitutions}
              </div>
              <div className="text-xs text-muted-foreground">Subs</div>
            </div>
            {gameSummary.formation_used && (
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-xl font-bold text-primary">
                  {gameSummary.formation_used}
                </div>
                <div className="text-xs text-muted-foreground">Formation</div>
              </div>
            )}
          </div>
        )}

        {/* Player Stats Table */}
        <div className="overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-center w-[60px]">Goals</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden sm:table-cell">Minutes by Position</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Subs</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedStats.map((stat) => (
                <TableRow key={stat.id}>
                  <TableCell className="font-medium text-muted-foreground">
                    {stat.jersey_number || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {stat.profiles?.avatar_url ? (
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={stat.profiles.avatar_url} />
                          <AvatarFallback className="text-xs">
                            {(stat.profiles?.display_name || stat.fill_in_player_name || "?").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <span className="font-medium">
                        {stat.fill_in_player_name || stat.profiles?.display_name || "Unknown"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={`text-center font-mono ${stat.goals_scored > 0 ? 'font-bold text-primary' : ''}`}>
                    {stat.goals_scored || 0}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMinutes(stat.minutes_played)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {stat.position_minutes && Object.keys(stat.position_minutes).length > 0 ? (
                        Object.entries(stat.position_minutes)
                          .sort(([, a], [, b]) => (b as number) - (a as number))
                          .map(([pos, secs]) => (
                            <span
                              key={pos}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted"
                            >
                              {pos}: {formatMinutes(secs as number)}
                            </span>
                          ))
                      ) : (
                        stat.positions_played.map((pos) => (
                          <span
                            key={pos}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted"
                          >
                            {pos}
                          </span>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center hidden sm:table-cell">
                    {stat.substitutions_count}
                  </TableCell>
                  <TableCell className="text-center hidden sm:table-cell">
                    {stat.started_on_pitch ? "✓" : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
