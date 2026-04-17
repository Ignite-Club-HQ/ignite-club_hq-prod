import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export interface ReturningPlayer {
  club_player_id: string;
  display_name: string;
  date_of_birth: string | null;
  age_years: number | null;
  previous_team_id: string;
  previous_team_name: string;
  membership_role: string;
}

interface Props {
  sourceSeasonId: string;
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

export function ReturningMembersStep({ sourceSeasonId, selectedIds, onChange }: Props) {
  const [filter, setFilter] = useState("");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["returning-players", sourceSeasonId],
    queryFn: async (): Promise<ReturningPlayer[]> => {
      const { data, error } = await supabase.rpc("get_returning_players", {
        _source_season_id: sourceSeasonId,
      });
      if (error) throw error;
      return (data ?? []) as ReturningPlayer[];
    },
  });

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? players.filter((p) => p.display_name.toLowerCase().includes(f))
      : players;
    const map = new Map<string, ReturningPlayer[]>();
    filtered.forEach((p) => {
      const key = p.previous_team_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [players, filter]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleGroup = (groupPlayers: ReturningPlayer[]) => {
    const next = new Set(selectedIds);
    const allSelected = groupPlayers.every((p) => next.has(p.club_player_id));
    if (allSelected) {
      groupPlayers.forEach((p) => next.delete(p.club_player_id));
    } else {
      groupPlayers.forEach((p) => next.add(p.club_player_id));
    }
    onChange(next);
  };

  const selectAll = () => onChange(new Set(players.map((p) => p.club_player_id)));
  const clearAll = () => onChange(new Set());

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Users className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No players from the previous season to carry over.
        </p>
        <p className="text-xs text-muted-foreground">
          You can assign players to teams later from each team page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">Returning members</h3>
          <p className="text-sm text-muted-foreground">
            Pick which players carry over. They'll be placed in the new team with the matching name.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search players…"
          className="flex-1 h-9 px-3 rounded-md border bg-background text-sm"
        />
        <Button variant="ghost" size="sm" onClick={selectAll}>All</Button>
        <Button variant="ghost" size="sm" onClick={clearAll}>None</Button>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        {selectedIds.size} of {players.length} selected
      </div>

      <ScrollArea className="h-[280px] rounded-lg border">
        <div className="p-2 space-y-3">
          {grouped.map(([teamName, groupPlayers]) => {
            const allSelected = groupPlayers.every((p) => selectedIds.has(p.club_player_id));
            const someSelected = groupPlayers.some((p) => selectedIds.has(p.club_player_id));
            return (
              <div key={teamName} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(groupPlayers)}
                  className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-muted text-left"
                >
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    className="pointer-events-none"
                  />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">
                    {teamName}
                  </span>
                  <span className="text-xs text-muted-foreground">{groupPlayers.length}</span>
                </button>
                <div className="ml-2 space-y-0.5">
                  {groupPlayers.map((p) => {
                    const checked = selectedIds.has(p.club_player_id);
                    const ageFlag = p.age_years != null && p.age_years >= 18;
                    return (
                      <label
                        key={p.club_player_id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(p.club_player_id)}
                        />
                        <span className="text-sm flex-1 truncate">{p.display_name}</span>
                        {p.age_years != null && (
                          <Badge variant="outline" className="text-xs h-5">
                            {p.age_years}y
                          </Badge>
                        )}
                        {ageFlag && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        Tip: Players whose previous team name doesn't exist in the new season will be added to the club roster but left unassigned.
      </p>
    </div>
  );
}
