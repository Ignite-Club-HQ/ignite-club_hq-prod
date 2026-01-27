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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
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

  // Separate upcoming and past events
  const upcomingEvents = events?.filter(e => !e.is_cancelled && (isFuture(parseISO(e.event_date)) || isToday(parseISO(e.event_date)))) || [];
  const pastEvents = events?.filter(e => !e.is_cancelled && !isFuture(parseISO(e.event_date)) && !isToday(parseISO(e.event_date))) || [];

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
                <p className="text-2xl font-bold">{events?.length || 0}</p>
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
            <Button size="sm" onClick={() => navigate(`/events/new?type=mini_league&mini_league_id=${id}&club_id=${league.club_id}`)}>
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Button>
          </div>

          {eventsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : events?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Calendar className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No sessions scheduled</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {upcomingEvents.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Upcoming</h3>
                  {upcomingEvents.map((event) => (
                    <Card
                      key={event.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/events/${event.id}`)}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {event.title || (isToday(parseISO(event.event_date)) 
                                  ? "Today" 
                                  : format(parseISO(event.event_date), "EEE, MMM d"))}
                              </span>
                              {isToday(parseISO(event.event_date)) && (
                                <Badge variant="default">Today</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              {event.start_time && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {event.start_time.slice(0, 5)}
                                  {event.end_time && ` - ${event.end_time.slice(0, 5)}`}
                                </span>
                              )}
                              {event.location_name && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {event.location_name}
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
              
              {pastEvents.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Past</h3>
                  {pastEvents.slice(0, 5).map((event) => (
                    <Card
                      key={event.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors opacity-75"
                      onClick={() => navigate(`/events/${event.id}`)}
                    >
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-sm">
                            <span>{event.title || format(parseISO(event.event_date), "MMM d, yyyy")}</span>
                            {event.start_time && (
                              <span className="text-muted-foreground">
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

        <TabsContent value="players" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Player Pool</h2>
            <AddMiniLeagueMemberSheet
              miniLeagueId={id!}
              miniLeagueName={league.name}
              clubId={league.club_id}
            />
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
