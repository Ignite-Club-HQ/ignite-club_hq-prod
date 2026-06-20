import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trophy, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type StatRow = {
  playhq_game_id: string;
  playhq_team_id: string | null;
  playhq_player_id: string;
  player_name: string | null;
  stats: Record<string, number> | null;
};

type Aggregate = {
  playhq_player_id: string;
  player_name: string;
  games: number;
  totals: Record<string, number>;
};

const NUMERIC = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default function CompetitionPlayerStatsPanel({
  competitionId,
}: {
  competitionId: string;
}) {
  const { user } = useAuth();

  // 1. Match list for this competition (need external_ids to filter stats,
  //    and team names + external team ids to power the filters below).
  const { data: matches = [], isLoading: matchesLoading } = useQuery({
    queryKey: ["competition-playhq-match-ids", competitionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_matches")
        .select("external_id, external_home_team_id, external_away_team_id, home_team_name, away_team_name")
        .eq("competition_id", competitionId)
        .eq("source", "playhq")
        .not("external_id", "is", null);
      if (error) throw error;
      return (data ?? []) as {
        external_id: string;
        external_home_team_id: string | null;
        external_away_team_id: string | null;
        home_team_name: string | null;
        away_team_name: string | null;
      }[];
    },
  });

  const gameIds = useMemo(
    () => Array.from(new Set(matches.map((m) => m.external_id).filter(Boolean))),
    [matches]
  );

  // PlayHQ team id → display name (from match rows)
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of matches) {
      if (row.external_home_team_id) m.set(row.external_home_team_id, row.home_team_name ?? row.external_home_team_id);
      if (row.external_away_team_id) m.set(row.external_away_team_id, row.away_team_name ?? row.external_away_team_id);
    }
    return m;
  }, [matches]);

  const externalTeamIds = useMemo(() => Array.from(teamNameById.keys()), [teamNameById]);

  // Resolve PlayHQ team id → owning Ignite club (when a team has been linked).
  const { data: linkedTeams = [] } = useQuery({
    queryKey: ["competition-stats-linked-teams", competitionId, externalTeamIds.length],
    enabled: externalTeamIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("playhq_team_id, clubs:club_id(id, name)")
        .in("playhq_team_id", externalTeamIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clubByExternalTeam = useMemo(() => {
    const m = new Map<string, { clubId: string; clubName: string }>();
    for (const t of linkedTeams as any[]) {
      if (t.playhq_team_id && t.clubs?.id) {
        m.set(t.playhq_team_id, { clubId: t.clubs.id, clubName: t.clubs.name });
      }
    }
    return m;
  }, [linkedTeams]);

  // 2. Player stats joined by game id
  const { data: rows = [], isLoading: statsLoading } = useQuery({
    queryKey: ["competition-playhq-stats", competitionId, gameIds.length],
    enabled: gameIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playhq_player_stats")
        .select("playhq_game_id, playhq_team_id, playhq_player_id, player_name, stats")
        .in("playhq_game_id", gameIds);
      if (error) throw error;
      return (data ?? []) as StatRow[];
    },
  });

  // 3. Existing claims
  const { data: links = [], refetch: refetchLinks } = useQuery({
    queryKey: ["playhq-player-links-mine"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playhq_player_links")
        .select("playhq_player_id, user_id, confirmed_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const claimsByPlayer = useMemo(() => {
    const m = new Map<string, { mine: boolean; claimed: boolean }>();
    for (const l of links as any[]) {
      const prev = m.get(l.playhq_player_id) ?? { mine: false, claimed: false };
      m.set(l.playhq_player_id, {
        mine: prev.mine || l.user_id === user?.id,
        claimed: true,
      });
    }
    return m;
  }, [links, user?.id]);

  // 4. Aggregate
  const aggregates: Aggregate[] = useMemo(() => {
    const map = new Map<string, Aggregate>();
    for (const r of rows) {
      const key = r.playhq_player_id;
      if (!key) continue;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          playhq_player_id: key,
          player_name: r.player_name ?? "Unknown",
          games: 0,
          totals: {},
        };
        map.set(key, agg);
      }
      agg.games += 1;
      for (const [k, v] of Object.entries(r.stats ?? {})) {
        agg.totals[k] = (agg.totals[k] ?? 0) + NUMERIC(v);
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const statKeys = useMemo(() => {
    const set = new Set<string>();
    aggregates.forEach((a) => Object.keys(a.totals).forEach((k) => set.add(k)));
    return Array.from(set);
  }, [aggregates]);

  const [sortBy, setSortBy] = useState<string>("");
  const sortKey = sortBy || statKeys[0] || "";

  const sorted = useMemo(() => {
    const list = [...aggregates];
    if (sortKey) {
      list.sort((a, b) => (b.totals[sortKey] ?? 0) - (a.totals[sortKey] ?? 0));
    } else {
      list.sort((a, b) => b.games - a.games);
    }
    return list;
  }, [aggregates, sortKey]);

  const claim = async (playhqPlayerId: string, playerName: string) => {
    if (!user) {
      toast.error("Sign in to claim a player");
      return;
    }
    const { error } = await supabase.from("playhq_player_links").insert({
      tenant: "default",
      playhq_player_id: playhqPlayerId,
      user_id: user.id,
      claimed_by: user.id,
      confirmed_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Claimed ${playerName}`);
    refetchLinks();
  };

  if (matchesLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading stats…
      </div>
    );
  }

  if (gameIds.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
        No PlayHQ-sourced matches in this competition yet. Once the next sync runs,
        player stats will appear here.
      </div>
    );
  }

  if (aggregates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
        Matches synced, but no per-player stats have been published by PlayHQ yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4" />
          {aggregates.length} players · {gameIds.length} matches
        </div>
        {statKeys.length > 0 && (
          <Select value={sortKey} onValueChange={setSortBy}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {statKeys.map((k) => (
                <SelectItem key={k} value={k} className="capitalize text-xs">
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Player</th>
              <th className="text-right p-2 font-medium">GP</th>
              {statKeys.map((k) => (
                <th
                  key={k}
                  className={`text-right p-2 font-medium capitalize ${
                    k === sortKey ? "text-foreground" : ""
                  }`}
                >
                  {k}
                </th>
              ))}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const claim_ = claimsByPlayer.get(a.playhq_player_id);
              return (
                <tr key={a.playhq_player_id} className="border-t">
                  <td className="p-2 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{a.player_name}</span>
                      {claim_?.mine && (
                        <Badge variant="secondary" className="text-[10px]">
                          You
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{a.games}</td>
                  {statKeys.map((k) => (
                    <td
                      key={k}
                      className={`p-2 text-right tabular-nums ${
                        k === sortKey ? "font-semibold" : ""
                      }`}
                    >
                      {a.totals[k] ?? 0}
                    </td>
                  ))}
                  <td className="p-2 text-right">
                    {claim_?.claimed ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <UserCheck className="h-3 w-3" /> Claimed
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => claim(a.playhq_player_id, a.player_name)}
                      >
                        Claim
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Stats sourced from PlayHQ. Claim a player to link their PlayHQ record to your
        account — claims help us match stats across competitions.
      </p>
    </div>
  );
}
