import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { 
  ArrowLeft, Users, Check, X, Clock, Loader2, Wand2, 
  LayoutGrid, ChevronRight, Star, AlertCircle, Calendar, ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Player {
  id: string;
  name: string;
  ability_rating: number;
}

interface Availability {
  id: string;
  player_id: string;
  status: "available" | "unavailable" | "late" | "unknown";
}

interface Group {
  id: string;
  name: string;
  ability_band: string | null;
  target_size: number;
  pitch_name: string | null;
  display_order: number;
  players?: Player[];
}

export default function MiniLeagueSessionPage() {
  const { id: leagueId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("availability");
  const [isAutoGroupOpen, setIsAutoGroupOpen] = useState(false);

  // Fetch session details with linked event
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["mini-league-session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_sessions")
        .select("*, mini_league:mini_leagues(id, name, team_size)")
        .eq("id", sessionId!)
        .single();
      if (error) throw error;
      return data as {
        id: string;
        session_date: string;
        start_time: string;
        end_time: string | null;
        location_name: string | null;
        status: string;
        team_size_override: number | null;
        linked_event_id: string | null;
        mini_league: { id: string; name: string; team_size: number } | null;
      };
    },
    enabled: !!sessionId,
  });

  // Fetch linked event RSVP counts
  const { data: linkedEventRsvps } = useQuery({
    queryKey: ["session-linked-event-rsvps", session?.linked_event_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("status")
        .eq("event_id", session!.linked_event_id!);
      if (error) throw error;
      const counts = { going: 0, maybe: 0, not_going: 0 };
      data.forEach(r => {
        if (r.status === "going") counts.going++;
        else if (r.status === "maybe") counts.maybe++;
        else if (r.status === "not_going") counts.not_going++;
      });
      return counts;
    },
    enabled: !!session?.linked_event_id,
  });

  // Fetch all players in the league
  const { data: players } = useQuery({
    queryKey: ["mini-league-players", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating")
        .eq("mini_league_id", leagueId!)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as Player[];
    },
    enabled: !!leagueId,
  });

  // Fetch availability for this session
  const { data: availability } = useQuery({
    queryKey: ["session-availability", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_session_availability")
        .select("*")
        .eq("session_id", sessionId!);
      if (error) throw error;
      return data as Availability[];
    },
    enabled: !!sessionId,
  });

  // Fetch groups for this session
  const { data: groups } = useQuery({
    queryKey: ["session-groups", sessionId],
    queryFn: async () => {
      const { data: groupsData, error: groupsError } = await supabase
        .from("mini_league_groups")
        .select("*")
        .eq("session_id", sessionId!)
        .order("display_order");
      if (groupsError) throw groupsError;

      // Fetch group players
      const { data: groupPlayers, error: gpError } = await supabase
        .from("mini_league_group_players")
        .select("group_id, player_id")
        .in("group_id", groupsData?.map(g => g.id) || []);
      if (gpError) throw gpError;

      // Map players to groups
      const groupsWithPlayers = groupsData?.map(group => ({
        ...group,
        players: groupPlayers
          ?.filter(gp => gp.group_id === group.id)
          .map(gp => players?.find(p => p.id === gp.player_id))
          .filter(Boolean) || [],
      }));

      return groupsWithPlayers as Group[];
    },
    enabled: !!sessionId && !!players,
  });

  // Update availability mutation
  const updateAvailabilityMutation = useMutation({
    mutationFn: async ({ playerId, status }: { playerId: string; status: Availability["status"] }) => {
      const existing = availability?.find(a => a.player_id === playerId);
      if (existing) {
        const { error } = await supabase
          .from("mini_league_session_availability")
          .update({ status, marked_by: user!.id })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("mini_league_session_availability").insert({
          session_id: sessionId!,
          player_id: playerId,
          status,
          marked_by: user!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-availability", sessionId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Auto-group mutation
  const autoGroupMutation = useMutation({
    mutationFn: async () => {
      // Get available players
      const availablePlayerIds = new Set(
        availability?.filter(a => a.status === "available" || a.status === "late").map(a => a.player_id) || []
      );
      const availablePlayers = players?.filter(p => availablePlayerIds.has(p.id)) || [];
      
      if (availablePlayers.length === 0) {
        throw new Error("No available players to group");
      }

      const teamSize = session?.team_size_override || session?.mini_league?.team_size || 5;
      
      // Group by ability rating
      const byAbility: Record<number, Player[]> = {};
      availablePlayers.forEach(p => {
        if (!byAbility[p.ability_rating]) byAbility[p.ability_rating] = [];
        byAbility[p.ability_rating].push(p);
      });

      // Create groups - one per ability level, split if too large
      const newGroups: { name: string; ability_band: string; players: Player[] }[] = [];
      let groupIndex = 0;
      const groupNames = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

      [5, 4, 3, 2, 1].forEach(rating => {
        const playersAtLevel = byAbility[rating] || [];
        if (playersAtLevel.length === 0) return;

        // Split into chunks of teamSize * 2 (for 2 teams per pitch)
        const chunkSize = teamSize * 2;
        for (let i = 0; i < playersAtLevel.length; i += chunkSize) {
          const chunk = playersAtLevel.slice(i, i + chunkSize);
          newGroups.push({
            name: `Group ${groupNames[groupIndex]}`,
            ability_band: `Ability ${rating}`,
            players: chunk,
          });
          groupIndex++;
        }
      });

      // Handle remainder players by mixing if needed
      // (In Phase 1, we'll just create as-is)

      // Delete existing groups for this session
      await supabase.from("mini_league_groups").delete().eq("session_id", sessionId!);

      // Create new groups
      for (let i = 0; i < newGroups.length; i++) {
        const group = newGroups[i];
        const { data: newGroup, error: groupError } = await supabase
          .from("mini_league_groups")
          .insert({
            session_id: sessionId!,
            name: group.name,
            ability_band: group.ability_band,
            target_size: teamSize,
            pitch_name: `Pitch ${i + 1}`,
            display_order: i,
          })
          .select()
          .single();

        if (groupError) throw groupError;

        // Add players to group
        const playerInserts = group.players.map(p => ({
          group_id: newGroup.id,
          player_id: p.id,
        }));

        if (playerInserts.length > 0) {
          const { error: playersError } = await supabase
            .from("mini_league_group_players")
            .insert(playerInserts);
          if (playersError) throw playersError;
        }
      }

      return newGroups.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["session-groups", sessionId] });
      setIsAutoGroupOpen(false);
      toast.success(`Created ${count} groups`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const getPlayerStatus = (playerId: string): Availability["status"] => {
    return availability?.find(a => a.player_id === playerId)?.status || "unknown";
  };

  const getStatusColor = (status: Availability["status"]) => {
    switch (status) {
      case "available": return "bg-green-500";
      case "unavailable": return "bg-destructive";
      case "late": return "bg-yellow-500";
      default: return "bg-muted";
    }
  };

  const availableCount = useMemo(() => 
    availability?.filter(a => a.status === "available" || a.status === "late").length || 0
  , [availability]);

  if (sessionLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/mini-leagues/${leagueId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">
            {format(parseISO(session.session_date), "EEEE, MMMM d")}
          </h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {session.start_time?.slice(0, 5)}
            {session.end_time && ` - ${session.end_time.slice(0, 5)}`}
            {session.location_name && ` • ${session.location_name}`}
          </p>
        </div>
        <Badge variant={session.status === "locked" ? "secondary" : "outline"}>
          {session.status}
        </Badge>
      </div>

      {/* RSVP Card - Link to Event */}
      {session.linked_event_id && (
        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors border-primary/20"
          onClick={() => navigate(`/events/${session.linked_event_id}`)}
        >
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Event RSVPs</p>
                  <p className="text-sm text-muted-foreground">
                    {linkedEventRsvps ? (
                      <>
                        <span className="text-green-600">{linkedEventRsvps.going} going</span>
                        {linkedEventRsvps.maybe > 0 && <span> • {linkedEventRsvps.maybe} maybe</span>}
                      </>
                    ) : (
                      "Manage attendance"
                    )}
                  </p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pool Available</span>
              <span className="text-lg font-bold text-primary">{availableCount}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Groups</span>
              <span className="text-lg font-bold">{groups?.length || 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabsContent value="availability" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Player Availability</h2>
          </div>

          {players?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No players in pool yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {players?.map((player) => {
                const status = getPlayerStatus(player.id);
                return (
                  <Card key={player.id}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
                          <div>
                            <span className="font-medium">{player.name}</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              {Array.from({ length: player.ability_rating }).map((_, i) => (
                                <Star key={i} className="h-3 w-3 fill-primary text-primary" />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={status === "available" ? "default" : "outline"}
                            className="h-8 w-8 p-0"
                            onClick={() => updateAvailabilityMutation.mutate({ 
                              playerId: player.id, 
                              status: "available" 
                            })}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant={status === "late" ? "default" : "outline"}
                            className="h-8 w-8 p-0"
                            onClick={() => updateAvailabilityMutation.mutate({ 
                              playerId: player.id, 
                              status: "late" 
                            })}
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant={status === "unavailable" ? "destructive" : "outline"}
                            className="h-8 w-8 p-0"
                            onClick={() => updateAvailabilityMutation.mutate({ 
                              playerId: player.id, 
                              status: "unavailable" 
                            })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="groups" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Groups</h2>
            <Button onClick={() => setIsAutoGroupOpen(true)}>
              <Wand2 className="h-4 w-4 mr-2" />
              Auto-Group
            </Button>
          </div>

          {availableCount === 0 && (
            <Card className="border-yellow-500/50 bg-yellow-500/10">
              <CardContent className="py-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <p className="text-sm">Mark player availability before creating groups</p>
              </CardContent>
            </Card>
          )}

          {groups?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <LayoutGrid className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No groups created yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Use Auto-Group to create ability-based groups
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {groups?.map((group) => (
                <Card key={group.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{group.name}</CardTitle>
                        <CardDescription>
                          {group.ability_band} • {group.pitch_name}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{group.players?.length || 0} players</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {group.players?.map((player) => (
                        <Badge key={player.id} variant="secondary">
                          {player.name}
                        </Badge>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      className="w-full mt-3 text-muted-foreground"
                      onClick={() => navigate(`/mini-leagues/${leagueId}/sessions/${sessionId}/groups/${group.id}/pitch`)}
                    >
                      Open Pitch Board
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Auto-Group Dialog */}
          <Dialog open={isAutoGroupOpen} onOpenChange={setIsAutoGroupOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Auto-Group Players</DialogTitle>
                <DialogDescription>
                  This will automatically create groups based on player ability ratings.
                  Players with similar abilities will be grouped together.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-2">
                <p className="text-sm">
                  <strong>{availableCount}</strong> players marked as available or late
                </p>
                <p className="text-sm text-muted-foreground">
                  Players per side: <strong>{session?.team_size_override || session?.mini_league?.team_size || 5}v{session?.team_size_override || session?.mini_league?.team_size || 5}</strong>
                  {session?.team_size_override && " (session override)"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Target: {(session?.team_size_override || session?.mini_league?.team_size || 5) * 2} players per pitch
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAutoGroupOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => autoGroupMutation.mutate()} 
                  disabled={autoGroupMutation.isPending || availableCount === 0}
                >
                  {autoGroupMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Groups
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
