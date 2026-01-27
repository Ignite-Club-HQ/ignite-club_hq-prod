import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, PlayCircle, Wand2, Loader2, X, ClipboardList, Copy, Shirt, RefreshCw, UserCheck, UserX, List } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";

// Default bib color pairs when league has no custom colors
const DEFAULT_BIB_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"];

// Get a pair of contrasting colors for a match from available colors
const getMatchColors = (index: number, availableColors: string[]): { teamA: string; teamB: string } => {
  const colors = availableColors.length >= 2 ? availableColors : DEFAULT_BIB_COLORS;
  // Pick two different colors for each match, cycling through available colors
  const colorIndex = (index * 2) % colors.length;
  const teamAColor = colors[colorIndex];
  const teamBColor = colors[(colorIndex + 1) % colors.length];
  return { teamA: teamAColor, teamB: teamBColor };
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

const getAbilityLabel = (rating: number): string => {
  switch (rating) {
    case 1: return "Beginner";
    case 2: return "Developing";
    case 3: return "Intermediate";
    case 4: return "Advanced";
    case 5: return "Expert";
    default: return "Unknown";
  }
};

interface GroupPlayer {
  id: string;
  name: string;
  team: "a" | "b" | null;
  ability_rating: number;
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
  const [isResponsesOpen, setIsResponsesOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newPitchName, setNewPitchName] = useState("");
  const [numGroups, setNumGroups] = useState(2);
  const [playersPerTeam, setPlayersPerTeam] = useState(6);
  const [useAutoMode, setUseAutoMode] = useState(true);
  const [abilityMode, setAbilityMode] = useState<"similar" | "mixed">("similar");
  const [selectedPreviousEventId, setSelectedPreviousEventId] = useState<string | null>(null);
  const [playerAvailability, setPlayerAvailability] = useState<Record<string, boolean>>({});
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [availabilityInitialized, setAvailabilityInitialized] = useState(false);

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
            .select("id, name, ability_rating")
            .in("id", playerIds);
          
          players = (playersData || []).map(p => ({
            ...p,
            ability_rating: p.ability_rating || 3,
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
        .select("id, name, team_size, bib_colors")
        .eq("id", miniLeagueId)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; team_size: number; bib_colors: string[] | null };
    },
    enabled: !!miniLeagueId,
  });

  // Fetch mini league players for auto-generation
  const { data: allPlayers } = useQuery({
    queryKey: ["mini-league-players", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating, parent_user_id, child_id")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as (MiniLeaguePlayer & { child_id: string | null })[];
    },
    enabled: !!miniLeagueId,
  });

  // Fetch RSVPs for this event to determine who is attending
  const { data: eventRsvps } = useQuery({
    queryKey: ["event-rsvps-going", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id")
        .eq("event_id", eventId)
        .eq("status", "going");
      if (error) throw error;
      return data as { user_id: string; child_id: string | null }[];
    },
    enabled: !!eventId,
  });

  // Map RSVPs to mini league players
  const rsvpPlayerIds = new Set<string>();
  if (eventRsvps && allPlayers) {
    allPlayers.forEach(player => {
      // Check if player's child_id matches an RSVP child_id
      if (player.child_id) {
        const hasChildRsvp = eventRsvps.some(r => r.child_id === player.child_id);
        if (hasChildRsvp) {
          rsvpPlayerIds.add(player.id);
        }
      }
      // Also check if player's parent has RSVP'd (for players without child_id)
      if (player.parent_user_id) {
        const hasParentRsvp = eventRsvps.some(r => r.user_id === player.parent_user_id && !r.child_id);
        if (hasParentRsvp) {
          rsvpPlayerIds.add(player.id);
        }
      }
    });
  }

  // Players who RSVP'd going
  const rsvpGoingPlayers = allPlayers?.filter(p => rsvpPlayerIds.has(p.id)) || [];

  // Initialize player availability when responses dialog opens (default to RSVP status)
  const initializeAvailability = () => {
    if (allPlayers) {
      const availability: Record<string, boolean> = {};
      allPlayers.forEach(p => {
        // Default to RSVP status - only "going" players are available
        // But allow admin override if they've already toggled
        if (availabilityInitialized && playerAvailability[p.id] !== undefined) {
          availability[p.id] = playerAvailability[p.id];
        } else {
          availability[p.id] = rsvpPlayerIds.has(p.id);
        }
      });
      setPlayerAvailability(availability);
      setAvailabilityInitialized(true);
    }
  };

  // Reset availability when responses dialog opens
  useEffect(() => {
    if (isResponsesOpen && allPlayers && !availabilityInitialized) {
      initializeAvailability();
    }
    if (!isResponsesOpen) {
      setAvailabilityInitialized(false);
    }
  }, [isResponsesOpen, allPlayers, eventRsvps]);

  // Get available players only (those selected for this session)
  const availablePlayers = allPlayers?.filter(p => playerAvailability[p.id] === true) || [];

  // Toggle player availability
  const togglePlayerAvailability = (playerId: string) => {
    setPlayerAvailability(prev => ({
      ...prev,
      [playerId]: !prev[playerId],
    }));
  };

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
      const leagueColors = miniLeague?.bib_colors || DEFAULT_BIB_COLORS;
      const colors = getMatchColors(groups?.length || 0, leagueColors);
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
      if (!availablePlayers || availablePlayers.length === 0) {
        throw new Error("No available players for this session");
      }

      // Calculate number of groups based on mode
      // For matches: each match has 2 teams, so total players per match = playersPerTeam * 2
      const effectivePlayersPerTeam = useAutoMode && miniLeague?.team_size 
        ? miniLeague.team_size 
        : playersPerTeam;
      const playersPerMatch = effectivePlayersPerTeam * 2;
      const effectiveNumMatches = useAutoMode 
        ? Math.ceil(availablePlayers.length / playersPerMatch)
        : numGroups;

      if (effectiveNumMatches < 1) {
        throw new Error("Not enough players for matches");
      }

      // Sort by ability rating (already sorted desc)
      const sortedPlayers = [...availablePlayers];
      
      // Create matches with balanced ability using league's bib colors
      const leagueColors = miniLeague?.bib_colors || DEFAULT_BIB_COLORS;
      const matchNames = ["Match 1", "Match 2", "Match 3", "Match 4", "Match 5", "Match 6", "Match 7", "Match 8"];
      
      // Create the matches first
      const matchIds: string[] = [];
      for (let i = 0; i < effectiveNumMatches; i++) {
        const colors = getMatchColors(i, leagueColors);
        // For similar ability mode, assign ability bands; for mixed, leave null
        const abilityBand = abilityMode === "similar" 
          ? (["High", "Medium", "Low"][Math.floor(i / Math.ceil(effectiveNumMatches / 3))] || null)
          : null;
        
        const { data, error } = await supabase
          .from("event_groups")
          .insert({
            event_id: eventId,
            name: matchNames[i] || `Match ${i + 1}`,
            ability_band: abilityBand,
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

      // Calculate target sizes for each match - ensure even player counts per match
      // This guarantees equal team sizes within each match
      const totalPlayerCount = sortedPlayers.length;
      const matchTargetSizes: number[] = [];
      
      // Start with base even count per match
      const basePerMatch = Math.floor(totalPlayerCount / effectiveNumMatches);
      const baseEven = basePerMatch % 2 === 0 ? basePerMatch : basePerMatch - 1;
      let remaining = totalPlayerCount;
      
      for (let i = 0; i < effectiveNumMatches; i++) {
        // Calculate how many players this match should get
        // Prioritize filling matches to max capacity (even number) first
        const matchesLeft = effectiveNumMatches - i;
        const avgRemaining = remaining / matchesLeft;
        
        // Target: closest even number not exceeding playersPerMatch
        let target = Math.min(playersPerMatch, Math.floor(avgRemaining));
        // Make it even (round down)
        if (target % 2 !== 0) target = target - 1;
        // Ensure at least 2 players if we have them
        if (target < 2 && remaining >= 2) target = 2;
        // If this is the last match, take whatever is left
        if (i === effectiveNumMatches - 1) target = remaining;
        
        matchTargetSizes.push(target);
        remaining -= target;
      }
      
      // If total players is odd, only one match will have odd count (last match)
      // Redistribute to ensure most matches are balanced
      // Sort targets so larger matches come first (helps with snake draft)
      const sortedTargetIndices = matchTargetSizes
        .map((size, idx) => ({ size, idx }))
        .sort((a, b) => b.size - a.size)
        .map(item => item.idx);
      
      // Distribute players across matches based on ability mode
      const matchPlayers: { playerId: string; team: "a" | "b" }[][] = Array(effectiveNumMatches).fill(null).map(() => []);
      
      if (abilityMode === "similar") {
        // Similar ability mode: consecutive players (by rating) go to same match
        // Players are already sorted by ability desc
        let playerIdx = 0;
        for (let matchIdx = 0; matchIdx < effectiveNumMatches && playerIdx < sortedPlayers.length; matchIdx++) {
          const targetSize = matchTargetSizes[matchIdx];
          for (let j = 0; j < targetSize && playerIdx < sortedPlayers.length; j++) {
            matchPlayers[matchIdx].push({ playerId: sortedPlayers[playerIdx].id, team: "a" });
            playerIdx++;
          }
        }
      } else {
        // Mixed ability mode: snake draft across matches for even ability distribution
        // But respect the target sizes to ensure even player counts per match
        let forward = true;
        let matchIndex = 0;
        
        sortedPlayers.forEach((player) => {
          // Find next match that has room (under its target size)
          let attempts = 0;
          while (matchPlayers[matchIndex].length >= matchTargetSizes[matchIndex] && attempts < effectiveNumMatches * 2) {
            if (forward) {
              matchIndex++;
              if (matchIndex >= effectiveNumMatches) {
                matchIndex = effectiveNumMatches - 1;
                forward = false;
              }
            } else {
              matchIndex--;
              if (matchIndex < 0) {
                matchIndex = 0;
                forward = true;
              }
            }
            attempts++;
          }
          
          if (matchPlayers[matchIndex].length < matchTargetSizes[matchIndex]) {
            matchPlayers[matchIndex].push({ playerId: player.id, team: "a" });
          } else {
            // Fallback: find any match with room
            for (let i = 0; i < effectiveNumMatches; i++) {
              if (matchPlayers[i].length < matchTargetSizes[i]) {
                matchPlayers[i].push({ playerId: player.id, team: "a" });
                break;
              }
            }
          }
          
          // Move to next match in snake pattern
          if (forward) {
            matchIndex++;
            if (matchIndex >= effectiveNumMatches) {
              matchIndex = effectiveNumMatches - 1;
              forward = false;
            }
          } else {
            matchIndex--;
            if (matchIndex < 0) {
              matchIndex = 0;
              forward = true;
            }
          }
        });
      }
      
      // Balance teams within each match - split players evenly between Team A and B
      matchPlayers.forEach((players) => {
        const totalPlayers = players.length;
        // Equal split: e.g., 6 players = 3v3, 8 players = 4v4
        // If odd (only possible when total league is odd), Team B gets extra
        const teamASize = Math.floor(totalPlayers / 2);
        players.forEach((p, idx) => {
          p.team = idx < teamASize ? "a" : "b";
        });
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

  // Delete all groups mutation (for regeneration)
  const deleteAllGroupsMutation = useMutation({
    mutationFn: async () => {
      const groupIds = groups?.map(g => g.id) || [];
      for (const groupId of groupIds) {
        await supabase.from("event_groups").delete().eq("id", groupId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Regenerate handler
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await deleteAllGroupsMutation.mutateAsync();
      setIsAutoGenOpen(true);
    } catch (error) {
      // Error handled by mutation
    } finally {
      setIsRegenerating(false);
    }
  };
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
            <Button size="sm" variant="outline" onClick={() => setIsResponsesOpen(true)}>
              <List className="h-4 w-4 mr-1" />
              Responses ({availablePlayers.length})
            </Button>
            {groups && groups.length > 0 && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleRegenerate}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Regenerate
              </Button>
            )}
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
                            className="text-xs flex items-center gap-1"
                            style={{ backgroundColor: `${group.team_a_color}20`, borderColor: group.team_a_color }}
                          >
                            {player.name}
                            <span className="opacity-60 text-[10px]">({getAbilityLabel(player.ability_rating)})</span>
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
                            className="text-xs flex items-center gap-1"
                            style={{ backgroundColor: `${group.team_b_color}20`, borderColor: group.team_b_color }}
                          >
                            {player.name}
                            <span className="opacity-60 text-[10px]">({getAbilityLabel(player.ability_rating)})</span>
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

            {/* Ability Assignment Mode */}
            <div className="space-y-2">
              <Label>Ability Assignment</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={abilityMode === "similar" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-3"
                  onClick={() => setAbilityMode("similar")}
                >
                  <span className="font-medium">Similar Ability</span>
                  <span className="text-xs text-muted-foreground font-normal mt-0.5">
                    Same levels together
                  </span>
                </Button>
                <Button
                  variant={abilityMode === "mixed" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-3"
                  onClick={() => setAbilityMode("mixed")}
                >
                  <span className="font-medium">Mixed Ability</span>
                  <span className="text-xs text-muted-foreground font-normal mt-0.5">
                    Different levels mixed
                  </span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {abilityMode === "similar" 
                  ? "Players with similar ratings will be grouped in the same match"
                  : "Players of different abilities will be evenly distributed across matches"}
              </p>
            </div>

            {/* Player Count Summary */}
            <div className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Available Players</span>
                <span className="text-sm">
                  <span className="font-bold text-primary">{availablePlayers.length}</span>
                  <span className="text-muted-foreground"> / {allPlayers?.length || 0}</span>
                </span>
              </div>
              {availablePlayers.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                  No players available. Use the Responses button to manage player availability.
                </p>
              )}
            </div>

            {useAutoMode ? (
              <div className="p-3 rounded-lg border bg-primary/5">
                <p className="text-sm">
                  <span className="font-medium">{availablePlayers.length}</span> available players ÷{" "}
                  <span className="font-medium">{(miniLeague?.team_size || 6) * 2}</span> per match ={" "}
                  <span className="font-medium">
                    {Math.ceil(availablePlayers.length / ((miniLeague?.team_size || 6) * 2))}
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
                  {availablePlayers.length} available players will be distributed across {numGroups} matches
                  (~{Math.ceil(availablePlayers.length / numGroups)} per match)
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
              disabled={autoGenMutation.isPending || availablePlayers.length === 0}
            >
              {autoGenMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate ({availablePlayers.length} players)
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

      {/* Responses Dialog - RSVP Override */}
      <Dialog open={isResponsesOpen} onOpenChange={setIsResponsesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Player Responses</DialogTitle>
            <DialogDescription>
              Manage player availability for match generation. Override RSVP status if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <p className="font-medium text-sm">Available Players</p>
                <p className="text-xs text-muted-foreground">
                  {rsvpGoingPlayers.length} RSVP'd going
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-primary">{availablePlayers.length}</p>
                <p className="text-xs text-muted-foreground">of {allPlayers?.length || 0}</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  const newAvailability: Record<string, boolean> = {};
                  allPlayers?.forEach(p => { newAvailability[p.id] = true; });
                  setPlayerAvailability(newAvailability);
                }}
              >
                <UserCheck className="h-4 w-4 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  const newAvailability: Record<string, boolean> = {};
                  allPlayers?.forEach(p => { newAvailability[p.id] = rsvpPlayerIds.has(p.id); });
                  setPlayerAvailability(newAvailability);
                }}
              >
                Reset to RSVP
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  const newAvailability: Record<string, boolean> = {};
                  allPlayers?.forEach(p => { newAvailability[p.id] = false; });
                  setPlayerAvailability(newAvailability);
                }}
              >
                <UserX className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>

            {/* Player List */}
            <ScrollArea className="h-64 rounded-lg border">
              <div className="p-2 space-y-1">
                {allPlayers?.map((player) => {
                  const isAvailable = playerAvailability[player.id] === true;
                  const hasRsvp = rsvpPlayerIds.has(player.id);
                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                        isAvailable 
                          ? "bg-primary/5 hover:bg-primary/10" 
                          : "bg-muted/50 hover:bg-muted/70"
                      }`}
                      onClick={() => togglePlayerAvailability(player.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Checkbox 
                          checked={isAvailable} 
                          onCheckedChange={() => togglePlayerAvailability(player.id)}
                        />
                        <span className={`text-sm truncate ${!isAvailable ? "opacity-60" : ""}`}>
                          {player.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          ({getAbilityLabel(player.ability_rating)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasRsvp ? (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-5 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                            ✓ Going
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 opacity-50">
                            No RSVP
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsResponsesOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
