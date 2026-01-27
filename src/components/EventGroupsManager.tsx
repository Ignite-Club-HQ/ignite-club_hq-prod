import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, PlayCircle, Wand2, Loader2, X, ClipboardList, Copy, Shirt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

// Bib color options for teams
const BIB_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "White", value: "#ffffff" },
];

// Get a pair of contrasting colors for a match
const getMatchColors = (index: number): { teamA: string; teamB: string } => {
  const pairs = [
    { teamA: "#ef4444", teamB: "#3b82f6" }, // Red vs Blue
    { teamA: "#22c55e", teamB: "#eab308" }, // Green vs Yellow
    { teamA: "#f97316", teamB: "#a855f7" }, // Orange vs Purple
    { teamA: "#ec4899", teamB: "#ffffff" }, // Pink vs White
  ];
  return pairs[index % pairs.length];
};

interface EventGroupsManagerProps {
  eventId: string;
  miniLeagueId: string;
  isAdmin: boolean;
}

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  parent_user_id: string | null;
}

interface GroupPlayer {
  id: string;
  name: string;
  team: "a" | "b" | null;
}

interface EventGroup {
  id: string;
  name: string;
  ability_band: string | null;
  pitch_name: string | null;
  display_order: number;
  team_a_color: string;
  team_b_color: string;
  players: GroupPlayer[];
}

export function EventGroupsManager({ eventId, miniLeagueId, isAdmin }: EventGroupsManagerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAutoGenOpen, setIsAutoGenOpen] = useState(false);
  const [isCopyPreviousOpen, setIsCopyPreviousOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newPitchName, setNewPitchName] = useState("");
  const [numGroups, setNumGroups] = useState(2);
  const [playersPerTeam, setPlayersPerTeam] = useState(6);
  const [useAutoMode, setUseAutoMode] = useState(true);
  const [selectedPreviousEventId, setSelectedPreviousEventId] = useState<string | null>(null);

  // Fetch event groups
  const { data: groups, isLoading } = useQuery({
    queryKey: ["event-groups", eventId],
    queryFn: async () => {
      const { data: groupsData, error } = await supabase
        .from("event_groups")
        .select("*")
        .eq("event_id", eventId)
        .order("display_order");
      if (error) throw error;

      // Fetch players for each group with team assignment
      const groupsWithPlayers: EventGroup[] = [];
      for (const group of groupsData || []) {
        const { data: playerLinks } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", group.id);
        
        const playerIds = playerLinks?.map(p => p.player_id) || [];
        let players: GroupPlayer[] = [];
        
        if (playerIds.length > 0) {
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("id, name")
            .in("id", playerIds);
          
          players = (playersData || []).map(p => ({
            ...p,
            team: playerLinks?.find(pl => pl.player_id === p.id)?.team as "a" | "b" | null,
          }));
        }

        groupsWithPlayers.push({
          ...group,
          team_a_color: group.team_a_color || "#ef4444",
          team_b_color: group.team_b_color || "#3b82f6",
          players,
        });
      }
      return groupsWithPlayers;
    },
    enabled: !!eventId,
  });

  // Fetch mini league settings
  const { data: miniLeague } = useQuery({
    queryKey: ["mini-league-settings", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name, team_size")
        .eq("id", miniLeagueId)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; team_size: number };
    },
    enabled: !!miniLeagueId,
  });

  // Fetch mini league players for auto-generation
  const { data: allPlayers } = useQuery({
    queryKey: ["mini-league-players", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating, parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as MiniLeaguePlayer[];
    },
    enabled: !!miniLeagueId,
  });

  // Fetch previous events for copy
  const { data: previousEvents } = useQuery({
    queryKey: ["previous-mini-league-events", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date")
        .eq("mini_league_id", miniLeagueId)
        .neq("id", eventId)
        .order("event_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!miniLeagueId && isCopyPreviousOpen,
  });

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const colors = getMatchColors(groups?.length || 0);
      const { error } = await supabase.from("event_groups").insert({
        event_id: eventId,
        name: newGroupName.trim(),
        pitch_name: newPitchName.trim() || null,
        display_order: (groups?.length || 0) + 1,
        team_a_color: colors.teamA,
        team_b_color: colors.teamB,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsCreateOpen(false);
      setNewGroupName("");
      setNewPitchName("");
      toast.success("Match created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Auto-generate groups mutation (now creates matches with 2 teams each)
  const autoGenMutation = useMutation({
    mutationFn: async () => {
      if (!allPlayers || allPlayers.length === 0) {
        throw new Error("No players in this mini league");
      }

      // Calculate number of groups based on mode
      // For matches: each match has 2 teams, so total players per match = playersPerTeam * 2
      const effectivePlayersPerTeam = useAutoMode && miniLeague?.team_size 
        ? miniLeague.team_size 
        : playersPerTeam;
      const playersPerMatch = effectivePlayersPerTeam * 2;
      const effectiveNumMatches = useAutoMode 
        ? Math.ceil(allPlayers.length / playersPerMatch)
        : numGroups;

      if (effectiveNumMatches < 1) {
        throw new Error("Not enough players for matches");
      }

      // Sort by ability rating (already sorted)
      const sortedPlayers = [...allPlayers];
      
      // Create matches with balanced ability
      const matchNames = ["Match 1", "Match 2", "Match 3", "Match 4", "Match 5", "Match 6", "Match 7", "Match 8"];
      const abilityBands = ["High", "Medium", "Low"];
      
      // Create the matches first
      const matchIds: string[] = [];
      for (let i = 0; i < effectiveNumMatches; i++) {
        const colors = getMatchColors(i);
        const { data, error } = await supabase
          .from("event_groups")
          .insert({
            event_id: eventId,
            name: matchNames[i] || `Match ${i + 1}`,
            ability_band: abilityBands[Math.floor(i / Math.ceil(effectiveNumMatches / 3))] || null,
            pitch_name: `Pitch ${i + 1}`,
            display_order: i + 1,
            team_a_color: colors.teamA,
            team_b_color: colors.teamB,
          })
          .select()
          .single();
        if (error) throw error;
        matchIds.push(data.id);
      }

      // Distribute players across matches (snake draft for balance)
      // Each match gets playersPerMatch players
      const matchPlayers: { playerId: string; team: "a" | "b" }[][] = Array(effectiveNumMatches).fill(null).map(() => []);
      
      sortedPlayers.forEach((player, index) => {
        const matchIndex = Math.floor(index / playersPerMatch);
        if (matchIndex >= effectiveNumMatches) return; // Extra players if any
        
        const positionInMatch = index % playersPerMatch;
        // First half go to team A, second half to team B
        // But use snake draft within each team for balance
        const team: "a" | "b" = positionInMatch < effectivePlayersPerTeam ? "a" : "b";
        
        matchPlayers[matchIndex].push({ playerId: player.id, team });
      });

      // Insert player assignments with team
      for (let i = 0; i < effectiveNumMatches; i++) {
        if (matchPlayers[i].length > 0) {
          const assignments = matchPlayers[i].map(p => ({
            group_id: matchIds[i],
            player_id: p.playerId,
            team: p.team,
          }));
          await supabase.from("event_group_players").insert(assignments);
        }
      }

      return effectiveNumMatches;
    },
    onSuccess: (numCreated) => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsAutoGenOpen(false);
      toast.success(`${numCreated} matches created with balanced teams`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Copy from previous event mutation
  const copyFromPreviousMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPreviousEventId) throw new Error("Select an event");

      // Fetch groups from previous event
      const { data: prevGroups, error: groupsError } = await supabase
        .from("event_groups")
        .select("*")
        .eq("event_id", selectedPreviousEventId)
        .order("display_order");
      if (groupsError) throw groupsError;

      for (const prevGroup of prevGroups || []) {
        // Create new group with team colors
        const { data: newGroup, error: createError } = await supabase
          .from("event_groups")
          .insert({
            event_id: eventId,
            name: prevGroup.name,
            ability_band: prevGroup.ability_band,
            pitch_name: prevGroup.pitch_name,
            display_order: prevGroup.display_order,
            team_a_color: prevGroup.team_a_color || "#ef4444",
            team_b_color: prevGroup.team_b_color || "#3b82f6",
          })
          .select()
          .single();
        if (createError) throw createError;

        // Copy player assignments with team
        const { data: prevPlayers } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", prevGroup.id);

        if (prevPlayers && prevPlayers.length > 0) {
          const assignments = prevPlayers.map(p => ({
            group_id: newGroup.id,
            player_id: p.player_id,
            team: p.team,
          }));
          await supabase.from("event_group_players").insert(assignments);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsCopyPreviousOpen(false);
      setSelectedPreviousEventId(null);
      toast.success("Matches copied from previous event");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.from("event_groups").delete().eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      toast.success("Group deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Matches</h3>
        {isAdmin && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setIsCopyPreviousOpen(true)}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsAutoGenOpen(true)}>
              <Wand2 className="h-4 w-4 mr-1" />
              Auto
            </Button>
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        )}
      </div>

      {groups && groups.length > 0 ? (
        <div className="grid gap-3">
          {groups.map((group) => {
            const teamAPlayers = group.players.filter(p => p.team === "a");
            const teamBPlayers = group.players.filter(p => p.team === "b");
            const unassignedPlayers = group.players.filter(p => !p.team);
            
            return (
              <Card key={group.id} className="relative">
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteGroupMutation.mutate(group.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    {group.ability_band && (
                      <Badge variant="outline" className="text-xs">
                        {group.ability_band}
                      </Badge>
                    )}
                  </div>
                  {group.pitch_name && (
                    <CardDescription>{group.pitch_name}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Two Teams Display */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {/* Team A */}
                    <div className="p-2 rounded-lg border" style={{ borderColor: group.team_a_color }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Shirt className="h-4 w-4" style={{ color: group.team_a_color }} />
                        <span className="text-xs font-medium" style={{ color: group.team_a_color }}>
                          Team A
                        </span>
                        <span className="text-xs text-muted-foreground">({teamAPlayers.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {teamAPlayers.map((player) => (
                          <Badge
                            key={player.id}
                            variant="secondary"
                            className="text-xs"
                            style={{ backgroundColor: `${group.team_a_color}20`, borderColor: group.team_a_color }}
                          >
                            {player.name}
                          </Badge>
                        ))}
                        {teamAPlayers.length === 0 && (
                          <span className="text-xs text-muted-foreground">No players</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Team B */}
                    <div className="p-2 rounded-lg border" style={{ borderColor: group.team_b_color }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Shirt className="h-4 w-4" style={{ color: group.team_b_color }} />
                        <span className="text-xs font-medium" style={{ color: group.team_b_color }}>
                          Team B
                        </span>
                        <span className="text-xs text-muted-foreground">({teamBPlayers.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {teamBPlayers.map((player) => (
                          <Badge
                            key={player.id}
                            variant="secondary"
                            className="text-xs"
                            style={{ backgroundColor: `${group.team_b_color}20`, borderColor: group.team_b_color }}
                          >
                            {player.name}
                          </Badge>
                        ))}
                        {teamBPlayers.length === 0 && (
                          <span className="text-xs text-muted-foreground">No players</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Unassigned Players (if any) */}
                  {unassignedPlayers.length > 0 && (
                    <div className="mb-3 p-2 rounded-lg bg-muted/50">
                      <span className="text-xs text-muted-foreground">Unassigned: </span>
                      {unassignedPlayers.map((player) => (
                        <Badge key={player.id} variant="outline" className="text-xs ml-1">
                          {player.name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => navigate(`/events/${eventId}/groups/${group.id}/pitch`)}
                    >
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Pitch Board
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => navigate(`/events/${eventId}/groups/${group.id}/duties`)}
                    >
                      <ClipboardList className="h-4 w-4 mr-1" />
                      Duties
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No matches yet</p>
            {isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">
                Auto-generate balanced matches or create them manually
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Match Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent side="bottom" className="h-auto">
          <SheetHeader>
            <SheetTitle>Create Match</SheetTitle>
            <SheetDescription>Add a new match with two teams</SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Match Name</Label>
              <Input
                placeholder="e.g. Match 1, Finals"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pitch Name (optional)</Label>
              <Input
                placeholder="e.g. Pitch 1, North Field"
                value={newPitchName}
                onChange={(e) => setNewPitchName(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              className="w-full"
              onClick={() => createGroupMutation.mutate()}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
            >
              {createGroupMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Match
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Auto-Generate Dialog */}
      <Dialog open={isAutoGenOpen} onOpenChange={setIsAutoGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-Generate Matches</DialogTitle>
            <DialogDescription>
              Automatically create balanced matches with two teams each based on player ability
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Auto Mode Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <p className="font-medium text-sm">Use League Defaults</p>
                <p className="text-xs text-muted-foreground">
                  {miniLeague?.team_size || 6} players per side ({(miniLeague?.team_size || 6) * 2} per match)
                </p>
              </div>
              <Button
                variant={useAutoMode ? "default" : "outline"}
                size="sm"
                onClick={() => setUseAutoMode(!useAutoMode)}
              >
                {useAutoMode ? "Auto" : "Manual"}
              </Button>
            </div>

            {useAutoMode ? (
              <div className="p-3 rounded-lg border bg-primary/5">
                <p className="text-sm">
                  <span className="font-medium">{allPlayers?.length || 0}</span> players ÷{" "}
                  <span className="font-medium">{(miniLeague?.team_size || 6) * 2}</span> per match ={" "}
                  <span className="font-medium">
                    {Math.ceil((allPlayers?.length || 0) / ((miniLeague?.team_size || 6) * 2))}
                  </span>{" "}
                  matches
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Players per Side</Label>
                  <div className="flex gap-2">
                    {[4, 5, 6, 7, 8].map((n) => (
                      <Button
                        key={n}
                        variant={playersPerTeam === n ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPlayersPerTeam(n)}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Each match will have {playersPerTeam * 2} players total ({playersPerTeam} vs {playersPerTeam})
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Number of Matches</Label>
                  <div className="flex gap-2 flex-wrap">
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <Button
                        key={n}
                        variant={numGroups === n ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNumGroups(n)}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  {allPlayers?.length || 0} players will be distributed across {numGroups} matches
                  (~{Math.ceil((allPlayers?.length || 0) / numGroups)} per match)
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAutoGenOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => autoGenMutation.mutate()}
              disabled={autoGenMutation.isPending}
            >
              {autoGenMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy from Previous Dialog */}
      <Dialog open={isCopyPreviousOpen} onOpenChange={setIsCopyPreviousOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy from Previous</DialogTitle>
            <DialogDescription>
              Copy match assignments from a previous session
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-60 overflow-y-auto">
            {previousEvents?.map((event) => (
              <div
                key={event.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedPreviousEventId === event.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedPreviousEventId(event.id)}
              >
                <Checkbox checked={selectedPreviousEventId === event.id} />
                <div>
                  <p className="font-medium text-sm">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.event_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
            {(!previousEvents || previousEvents.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No previous events found
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCopyPreviousOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => copyFromPreviousMutation.mutate()}
              disabled={!selectedPreviousEventId || copyFromPreviousMutation.isPending}
            >
              {copyFromPreviousMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Copy Matches
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
