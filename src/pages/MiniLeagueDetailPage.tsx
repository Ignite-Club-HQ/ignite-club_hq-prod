import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isFuture, parseISO } from "date-fns";
import { 
  ArrowLeft, Users, Calendar, Plus, Settings, Trash2, Loader2, 
  ChevronRight, Clock, MapPin, Star, Pencil
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from "@/components/ui/alert-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { AddMiniLeagueMemberSheet } from "@/components/AddMiniLeagueMemberSheet";
import { toast } from "sonner";

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  notes: string | null;
  parent_user_id: string | null;
}

interface MiniLeagueEvent {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  is_cancelled: boolean;
}

export default function MiniLeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("sessions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

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

  // Fetch events linked to mini league
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["mini-league-events", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, start_time, end_time, location_name, is_cancelled")
        .eq("mini_league_id", id!)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return data as MiniLeagueEvent[];
    },
    enabled: !!id,
  });

  // Update league mutation
  const updateLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mini_leagues")
        .update({ 
          name: editName.trim(), 
          description: editDescription.trim() || null 
        })
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league", id] });
      setSettingsOpen(false);
      toast.success("Mini League updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete league mutation
  const deleteLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mini_leagues").delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mini League deleted");
      navigate("/mini-leagues");
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

  const getAbilityLabel = (rating: number) => {
    const labels = ["", "Beginner", "Developing", "Intermediate", "Advanced", "Expert"];
    return labels[rating] || "";
  };

  const getAbilityColor = (rating: number) => {
    const colors: Record<number, string> = {
      1: "bg-destructive/20 text-destructive",
      2: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
      3: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
      4: "bg-green-500/20 text-green-600 dark:text-green-400",
      5: "bg-primary/20 text-primary",
    };
    return colors[rating] || "";
  };

  const openSettings = () => {
    if (league) {
      setEditName(league.name);
      setEditDescription(league.description || "");
      setSettingsOpen(true);
    }
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

  // Separate upcoming and past events
  const upcomingEvents = events?.filter(e => !e.is_cancelled && (isFuture(parseISO(e.event_date)) || isToday(parseISO(e.event_date)))) || [];
  const pastEvents = events?.filter(e => !e.is_cancelled && !isFuture(parseISO(e.event_date)) && !isToday(parseISO(e.event_date))) || [];

  return (
    <div className="container max-w-4xl py-4 space-y-4">
      {/* Header - matching team/club style */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => navigate("/mini-leagues")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{league.name}</h1>
          <p className="text-sm text-muted-foreground truncate">{league.club?.name}</p>
        </div>
        <Button variant="outline" size="icon" className="shrink-0" onClick={openSettings}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {league.description && (
        <p className="text-sm text-muted-foreground px-1">{league.description}</p>
      )}

      {/* Stats - compact horizontal layout */}
      <div className="flex gap-3">
        <Card className="flex-1">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold">{players?.length || 0}</span>
                <span className="text-xs text-muted-foreground">Players</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold">{events?.length || 0}</span>
                <span className="text-xs text-muted-foreground">Sessions</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs - cleaner style */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-10">
          <TabsTrigger value="sessions" className="text-sm">Sessions</TabsTrigger>
          <TabsTrigger value="players" className="text-sm">Players</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-3 mt-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Sessions</h2>
            <Button 
              size="sm" 
              onClick={() => navigate(`/events/new?type=mini_league&mini_league_id=${id}&club_id=${league.club_id}`)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New Session
            </Button>
          </div>

          {eventsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : events?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No sessions scheduled</p>
                <Button 
                  variant="link" 
                  size="sm" 
                  className="mt-1"
                  onClick={() => navigate(`/events/new?type=mini_league&mini_league_id=${id}&club_id=${league.club_id}`)}
                >
                  Create your first session
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upcoming</h3>
                  {upcomingEvents.map((event) => (
                    <Card
                      key={event.id}
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => navigate(`/events/${event.id}`)}
                    >
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {event.title || format(parseISO(event.event_date), "EEE, MMM d")}
                              </span>
                              {isToday(parseISO(event.event_date)) && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0">Today</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              {event.start_time && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {event.start_time.slice(0, 5)}
                                </span>
                              )}
                              {event.location_name && (
                                <span className="flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{event.location_name}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              {pastEvents.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Past</h3>
                  {pastEvents.slice(0, 5).map((event) => (
                    <Card
                      key={event.id}
                      className="cursor-pointer hover:bg-accent/50 transition-colors opacity-60"
                      onClick={() => navigate(`/events/${event.id}`)}
                    >
                      <CardContent className="py-2.5 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-sm">
                            <span className="truncate">{event.title || format(parseISO(event.event_date), "MMM d")}</span>
                            {event.start_time && (
                              <span className="text-muted-foreground text-xs">
                                {event.start_time.slice(0, 5)}
                              </span>
                            )}
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

        <TabsContent value="players" className="space-y-3 mt-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Player Pool</h2>
            <AddMiniLeagueMemberSheet
              miniLeagueId={id!}
              miniLeagueName={league.name}
              clubId={league.club_id}
            />
          </div>

          {playersLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : players?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No players added yet</p>
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
                      <Badge className={`text-xs ${getAbilityColor(rating)}`}>
                        {getAbilityLabel(rating)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {abilityPlayers.length} player{abilityPlayers.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {abilityPlayers.map((player) => (
                        <Card key={player.id} className="overflow-hidden">
                          <CardContent className="py-2.5 px-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {Array.from({ length: rating }).map((_, i) => (
                                    <Star key={i} className="h-2.5 w-2.5 fill-primary text-primary" />
                                  ))}
                                </div>
                                <span className="text-sm font-medium truncate">{player.name}</span>
                              </div>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
                              <p className="text-xs text-muted-foreground mt-1 pl-[42px] truncate">
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

      {/* Settings Dialog */}
      <ResponsiveDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Mini League Settings</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="league-name">Name</Label>
              <Input
                id="league-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Mini League name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="league-description">Description</Label>
              <Textarea
                id="league-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>

          <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete League
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Mini League?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{league.name}" and all its players. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteLeagueMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button variant="outline" onClick={() => setSettingsOpen(false)} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button 
                onClick={() => updateLeagueMutation.mutate()}
                disabled={!editName.trim() || updateLeagueMutation.isPending}
                className="flex-1 sm:flex-none"
              >
                {updateLeagueMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
