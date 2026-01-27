import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isFuture, parseISO } from "date-fns";
import { 
  ArrowLeft, Users, Calendar, Plus, Settings, Trash2, Loader2, 
  ChevronRight, Clock, MapPin, Star
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  notes: string | null;
  parent_user_id: string | null;
}

interface MiniLeagueSession {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string | null;
  location_name: string | null;
  status: "draft" | "locked";
}

export default function MiniLeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("sessions");
  const [isAddPlayerOpen, setIsAddPlayerOpen] = useState(false);
  const [isAddSessionOpen, setIsAddSessionOpen] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ name: "", ability_rating: "3", notes: "" });
  const [newSession, setNewSession] = useState({ 
    session_date: "", 
    start_time: "09:00", 
    end_time: "10:00", 
    location_name: "",
    team_size_override: "" // Empty means use league default
  });

  // Fetch mini league details
  const { data: league, isLoading: leagueLoading } = useQuery({
    queryKey: ["mini-league", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*, club:clubs(id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch players
  const { data: players, isLoading: playersLoading } = useQuery({
    queryKey: ["mini-league-players", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("*")
        .eq("mini_league_id", id!)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as MiniLeaguePlayer[];
    },
    enabled: !!id,
  });

  // Fetch sessions
  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["mini-league-sessions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_sessions")
        .select("*")
        .eq("mini_league_id", id!)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return data as MiniLeagueSession[];
    },
    enabled: !!id,
  });

  // Add player mutation
  const addPlayerMutation = useMutation({
    mutationFn: async (data: typeof newPlayer) => {
      const { error } = await supabase.from("mini_league_players").insert({
        mini_league_id: id!,
        name: data.name,
        ability_rating: parseInt(data.ability_rating),
        notes: data.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", id] });
      setIsAddPlayerOpen(false);
      setNewPlayer({ name: "", ability_rating: "3", notes: "" });
      toast.success("Player added!");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Add session mutation
  const addSessionMutation = useMutation({
    mutationFn: async (data: typeof newSession) => {
      const { error } = await supabase.from("mini_league_sessions").insert({
        mini_league_id: id!,
        session_date: data.session_date,
        start_time: data.start_time,
        end_time: data.end_time || null,
        location_name: data.location_name || null,
        team_size_override: data.team_size_override ? parseInt(data.team_size_override) : null,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-sessions", id] });
      setIsAddSessionOpen(false);
      setNewSession({ session_date: "", start_time: "09:00", end_time: "10:00", location_name: "", team_size_override: "" });
      toast.success("Session created!");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete player mutation
  const deletePlayerMutation = useMutation({
    mutationFn: async (playerId: string) => {
      const { error } = await supabase.from("mini_league_players").delete().eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", id] });
      toast.success("Player removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleAddPlayer = () => {
    if (!newPlayer.name.trim()) {
      toast.error("Player name is required");
      return;
    }
    addPlayerMutation.mutate(newPlayer);
  };

  const handleAddSession = () => {
    if (!newSession.session_date) {
      toast.error("Session date is required");
      return;
    }
    addSessionMutation.mutate(newSession);
  };

  const getAbilityLabel = (rating: number) => {
    const labels = ["", "Beginner", "Developing", "Intermediate", "Advanced", "Expert"];
    return labels[rating] || "";
  };

  const getAbilityColor = (rating: number) => {
    const colors = ["", "bg-red-500/20 text-red-600", "bg-orange-500/20 text-orange-600", "bg-yellow-500/20 text-yellow-600", "bg-green-500/20 text-green-600", "bg-primary/20 text-primary"];
    return colors[rating] || "";
  };

  if (leagueLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Mini League not found</p>
        <Button variant="link" onClick={() => navigate("/mini-leagues")}>
          Back to Mini Leagues
        </Button>
      </div>
    );
  }

  // Group players by ability
  const playersByAbility = players?.reduce((acc, player) => {
    const key = player.ability_rating;
    if (!acc[key]) acc[key] = [];
    acc[key].push(player);
    return acc;
  }, {} as Record<number, MiniLeaguePlayer[]>) || {};

  // Separate upcoming and past sessions
  const upcomingSessions = sessions?.filter(s => isFuture(parseISO(s.session_date)) || isToday(parseISO(s.session_date))) || [];
  const pastSessions = sessions?.filter(s => !isFuture(parseISO(s.session_date)) && !isToday(parseISO(s.session_date))) || [];

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/mini-leagues")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{league.name}</h1>
          <p className="text-muted-foreground">{league.club?.name}</p>
        </div>
        <Button variant="outline" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {league.description && (
        <p className="text-muted-foreground">{league.description}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{players?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Players</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{sessions?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Sessions</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="players">Players</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Sessions</h2>
            <Dialog open={isAddSessionOpen} onOpenChange={setIsAddSessionOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Session
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Session</DialogTitle>
                  <DialogDescription>
                    Schedule a new session for this mini league
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Date *</Label>
                    <Input
                      type="date"
                      value={newSession.session_date}
                      onChange={(e) => setNewSession({ ...newSession, session_date: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Start</Label>
                      <Input
                        type="time"
                        value={newSession.start_time}
                        onChange={(e) => setNewSession({ ...newSession, start_time: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End</Label>
                      <Input
                        type="time"
                        value={newSession.end_time}
                        onChange={(e) => setNewSession({ ...newSession, end_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input
                      placeholder="e.g. Main Sports Ground"
                      value={newSession.location_name}
                      onChange={(e) => setNewSession({ ...newSession, location_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Players per Side</Label>
                    <div className="grid grid-cols-5 gap-2">
                      <Button
                        type="button"
                        variant={!newSession.team_size_override ? "default" : "outline"}
                        size="sm"
                        className="h-10 text-xs"
                        onClick={() => setNewSession({ ...newSession, team_size_override: "" })}
                      >
                        Default
                      </Button>
                      {["4", "5", "6", "7"].map((size) => (
                        <Button
                          key={size}
                          type="button"
                          variant={newSession.team_size_override === size ? "default" : "outline"}
                          size="sm"
                          className="h-10"
                          onClick={() => setNewSession({ ...newSession, team_size_override: size })}
                        >
                          {size}v{size}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Default: {league.team_size}v{league.team_size} from league settings
                    </p>
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setIsAddSessionOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddSession} disabled={addSessionMutation.isPending}>
                    {addSessionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {sessionsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sessions?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Calendar className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No sessions scheduled</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {upcomingSessions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Upcoming</h3>
                  {upcomingSessions.map((session) => (
                    <Card
                      key={session.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/mini-leagues/${id}/sessions/${session.id}`)}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {isToday(parseISO(session.session_date)) 
                                  ? "Today" 
                                  : format(parseISO(session.session_date), "EEE, MMM d")}
                              </span>
                              {isToday(parseISO(session.session_date)) && (
                                <Badge variant="default">Today</Badge>
                              )}
                              <Badge variant={session.status === "locked" ? "secondary" : "outline"}>
                                {session.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {session.start_time.slice(0, 5)}
                                {session.end_time && ` - ${session.end_time.slice(0, 5)}`}
                              </span>
                              {session.location_name && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {session.location_name}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              {pastSessions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Past</h3>
                  {pastSessions.slice(0, 5).map((session) => (
                    <Card
                      key={session.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors opacity-75"
                      onClick={() => navigate(`/mini-leagues/${id}/sessions/${session.id}`)}
                    >
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-sm">
                            <span>{format(parseISO(session.session_date), "MMM d, yyyy")}</span>
                            <span className="text-muted-foreground">
                              {session.start_time.slice(0, 5)}
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="players" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Player Pool</h2>
            <Dialog open={isAddPlayerOpen} onOpenChange={setIsAddPlayerOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Player
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Player</DialogTitle>
                  <DialogDescription>
                    Add a new player to the pool
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Player Name *</Label>
                    <Input
                      placeholder="e.g. John Smith"
                      value={newPlayer.name}
                      onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ability Rating</Label>
                    <Select 
                      value={newPlayer.ability_rating} 
                      onValueChange={(v) => setNewPlayer({ ...newPlayer, ability_rating: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Beginner</SelectItem>
                        <SelectItem value="2">2 - Developing</SelectItem>
                        <SelectItem value="3">3 - Intermediate</SelectItem>
                        <SelectItem value="4">4 - Advanced</SelectItem>
                        <SelectItem value="5">5 - Expert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      placeholder="Optional notes..."
                      value={newPlayer.notes}
                      onChange={(e) => setNewPlayer({ ...newPlayer, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddPlayerOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddPlayer} disabled={addPlayerMutation.isPending}>
                    {addPlayerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add Player
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {playersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : players?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No players added yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {[5, 4, 3, 2, 1].map((rating) => {
                const abilityPlayers = playersByAbility[rating];
                if (!abilityPlayers?.length) return null;
                
                return (
                  <div key={rating} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={getAbilityColor(rating)}>
                        {rating} - {getAbilityLabel(rating)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        ({abilityPlayers.length} players)
                      </span>
                    </div>
                    <div className="grid gap-2">
                      {abilityPlayers.map((player) => (
                        <Card key={player.id}>
                          <CardContent className="py-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1">
                                  {Array.from({ length: rating }).map((_, i) => (
                                    <Star key={i} className="h-3 w-3 fill-primary text-primary" />
                                  ))}
                                </div>
                                <span className="font-medium">{player.name}</span>
                              </div>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Player?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove {player.name} from the player pool.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deletePlayerMutation.mutate(player.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                            {player.notes && (
                              <p className="text-sm text-muted-foreground mt-1 ml-[52px]">
                                {player.notes}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
