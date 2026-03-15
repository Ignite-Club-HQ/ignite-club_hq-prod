import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isFuture, parseISO } from "date-fns";
import { 
  ArrowLeft, Users, Calendar, Plus, Settings, Trash2, Loader2, 
  ChevronRight, Clock, MapPin, Star, Pencil, Camera, ImageIcon, CheckSquare, Square, UsersRound, Shirt, X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { compressImage } from "@/lib/imageCompression";
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
import PendingInvitesList from "@/components/PendingInvitesList";
import { toast } from "sonner";

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  notes: string | null;
  parent_user_id: string | null;
  child_id: string | null;
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
  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(null);
  const [editTeamSize, setEditTeamSize] = useState<number>(4);
  const [editMinPlayersPerSide, setEditMinPlayersPerSide] = useState<number>(3);
  const [editMinutesPerHalf, setEditMinutesPerHalf] = useState<number>(10);
  const [editBibColors, setEditBibColors] = useState<string[]>([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [newBibColor, setNewBibColor] = useState("#ef4444");
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Available bib color presets
  const BIB_COLOR_PRESETS = [
    { name: "Red", value: "#ef4444" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Green", value: "#22c55e" },
    { name: "Yellow", value: "#eab308" },
    { name: "Orange", value: "#f97316" },
    { name: "Purple", value: "#a855f7" },
    { name: "Pink", value: "#ec4899" },
    { name: "Cyan", value: "#06b6d4" },
    { name: "White", value: "#ffffff" },
    { name: "Black", value: "#171717" },
  ];

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

  // Check if user can manage this league (admin/coach roles)
  const { data: canManageLeague } = useQuery({
    queryKey: ["can-manage-league", league?.club_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .or(`club_id.eq.${league!.club_id},role.eq.app_admin`);
      
      return data?.some(r => 
        ['club_admin', 'league_admin', 'coach', 'committee_member', 'app_admin'].includes(r.role)
      ) ?? false;
    },
    enabled: !!league?.club_id && !!user,
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

  // Fetch pending invites for this mini league
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", null, league?.club_id, id],
    queryFn: async () => {
      if (!league?.club_id) return [];
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, metadata")
        .eq("club_id", league.club_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Filter to only show invites for this mini league by checking metadata
      const filtered = (data || []).filter((inv: any) => {
        const metadata = inv.metadata as any;
        return metadata?.mini_league_id === id;
      });
      return filtered.map((inv: any) => ({
        ...inv,
        profiles: null, // No profile for pending invites
      }));
    },
    enabled: !!league?.club_id && !!id,
  });

  // Handle logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !league) return;

    setUploadingLogo(true);
    try {
      const { file: compressedFile } = await compressImage(file);
      const fileExt = "jpg";
      const fileName = `mini-league-${id}-${Date.now()}.${fileExt}`;
      const filePath = `${league.club_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(filePath, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("club-logos")
        .getPublicUrl(filePath);

      setEditLogoUrl(urlData.publicUrl);
      toast.success("Logo uploaded");
    } catch (error: any) {
      toast.error(error.message || "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // Update league mutation
  const updateLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mini_leagues")
        .update({ 
          name: editName.trim(), 
          description: editDescription.trim() || null,
          logo_url: editLogoUrl,
          team_size: editTeamSize,
          min_players_per_side: editMinPlayersPerSide,
          minutes_per_half: editMinutesPerHalf,
          bib_colors: editBibColors.length > 0 ? editBibColors : null
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

  // Bulk delete players mutation
  const bulkDeletePlayersMutation = useMutation({
    mutationFn: async (playerIds: string[]) => {
      const { error } = await supabase
        .from("mini_league_players")
        .delete()
        .in("id", playerIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", id] });
      setSelectedPlayerIds(new Set());
      setSelectionMode(false);
      setBulkDeleteOpen(false);
      toast.success("Players removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const togglePlayerSelection = (playerId: string) => {
    const newSet = new Set(selectedPlayerIds);
    if (newSet.has(playerId)) {
      newSet.delete(playerId);
    } else {
      newSet.add(playerId);
    }
    setSelectedPlayerIds(newSet);
  };

  const toggleSelectAll = () => {
    if (!players) return;
    if (selectedPlayerIds.size === players.length) {
      setSelectedPlayerIds(new Set());
    } else {
      setSelectedPlayerIds(new Set(players.map(p => p.id)));
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPlayerIds(new Set());
  };

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
      setEditLogoUrl(league.logo_url || null);
      setEditTeamSize(league.team_size || 4);
      setEditMinPlayersPerSide(league.min_players_per_side || 3);
      setEditMinutesPerHalf(league.minutes_per_half || 10);
      setEditBibColors(league.bib_colors || ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"]);
      setSettingsOpen(true);
    }
  };

  const addBibColor = (color: string) => {
    if (!editBibColors.includes(color)) {
      setEditBibColors([...editBibColors, color]);
    }
  };

  const removeBibColor = (color: string) => {
    setEditBibColors(editBibColors.filter(c => c !== color));
  };

  const getColorName = (hex: string) => {
    const preset = BIB_COLOR_PRESETS.find(p => p.value.toLowerCase() === hex.toLowerCase());
    return preset?.name || hex;
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
        {league.logo_url && (
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarImage src={league.logo_url} alt={league.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {league.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{league.name}</h1>
          <p className="text-sm text-muted-foreground truncate">{league.club?.name}</p>
        </div>
        {canManageLeague && (
          <Button variant="outline" size="icon" className="shrink-0" onClick={openSettings}>
            <Settings className="h-4 w-4" />
          </Button>
        )}
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
            {canManageLeague ? (
              <Button 
                size="sm" 
                onClick={() => navigate(`/events/new?type=mini_league&mini_league_id=${id}&club_id=${league.club_id}`)}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New Session
              </Button>
            ) : (
              <Button 
                size="sm" 
                variant="outline"
                className="opacity-60 relative"
                onClick={() => toast.error("Only admins and coaches can create sessions")}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New Session
                <span className="absolute -top-1 -right-1 text-[10px] bg-muted text-muted-foreground px-1 py-0.5 rounded">Admin</span>
              </Button>
            )}
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
                {canManageLeague ? (
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="mt-1"
                    onClick={() => navigate(`/events/new?type=mini_league&mini_league_id=${id}&club_id=${league.club_id}`)}
                  >
                    Create your first session
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Ask an admin or coach to create a session</p>
                )}
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
          <div className="flex justify-between items-center gap-2">
            <h2 className="text-base font-semibold">Player Pool</h2>
            <div className="flex items-center gap-2">
              {canManageLeague && (
                <>
                  {selectionMode ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={exitSelectionMode}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedPlayerIds.size === 0}
                        onClick={() => setBulkDeleteOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Delete ({selectedPlayerIds.size})
                      </Button>
                    </>
                  ) : (
                    <>
                      {(players?.length || 0) > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
                          <CheckSquare className="h-4 w-4 mr-1.5" />
                          Select
                        </Button>
                      )}
                      <AddMiniLeagueMemberSheet
                        miniLeagueId={id!}
                        miniLeagueName={league.name}
                        clubId={league.club_id}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Select All when in selection mode */}
          {selectionMode && players && players.length > 0 && (
            <div className="flex items-center gap-2 py-2 px-1 border-b">
              <Checkbox
                checked={selectedPlayerIds.size === players.length}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm text-muted-foreground">
                Select all ({players.length} players)
              </span>
            </div>
          )}

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
                        <Card 
                          key={player.id} 
                          className={`overflow-hidden ${selectionMode && selectedPlayerIds.has(player.id) ? 'ring-2 ring-primary' : ''}`}
                          onClick={selectionMode ? () => togglePlayerSelection(player.id) : undefined}
                        >
                          <CardContent className="py-2.5 px-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {selectionMode && (
                                  <Checkbox
                                    checked={selectedPlayerIds.has(player.id)}
                                    onCheckedChange={() => togglePlayerSelection(player.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                )}
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {Array.from({ length: rating }).map((_, i) => (
                                    <Star key={i} className="h-2.5 w-2.5 fill-primary text-primary" />
                                  ))}
                                </div>
                                <span className="text-sm font-medium truncate">{player.name}</span>
                              </div>
                              {!selectionMode && (
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
                              )}
                            </div>
                            {player.notes && (
                              <p className={`text-xs text-muted-foreground mt-1 truncate ${selectionMode ? 'pl-[66px]' : 'pl-[42px]'}`}>
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

          {/* Pending Parent Invites */}
          {pendingInvites.length > 0 && (
            <div className="space-y-2 mt-4">
              <h3 className="text-sm font-medium text-muted-foreground">Pending Parent Invites</h3>
              <PendingInvitesList
                invites={pendingInvites}
                clubId={league.club_id}
              />
            </div>
          )}

          {/* Bulk Delete Confirmation Dialog */}
          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {selectedPlayerIds.size} Players?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove {selectedPlayerIds.size} player{selectedPlayerIds.size !== 1 ? 's' : ''} from the player pool. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => bulkDeletePlayersMutation.mutate(Array.from(selectedPlayerIds))}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={bulkDeletePlayersMutation.isPending}
                >
                  {bulkDeletePlayersMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Remove All"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>

      {/* Settings Dialog */}
      <ResponsiveDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Mini League Settings</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Logo upload */}
            <div className="space-y-2">
              <Label>League Logo</Label>
              <div className="flex items-center gap-4">
                <div 
                  className="relative cursor-pointer group"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Avatar className="h-20 w-20 border-2 border-dashed border-muted-foreground/30 group-hover:border-primary transition-colors">
                    {editLogoUrl ? (
                      <AvatarImage src={editLogoUrl} alt="League logo" />
                    ) : null}
                    <AvatarFallback className="bg-muted">
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    {uploadingLogo ? (
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>Click to upload a logo</p>
                  <p className="text-xs">JPG, PNG up to 5MB</p>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                />
              </div>
            </div>

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
            <div className="space-y-2">
              <Label htmlFor="team-size">Default Players Per Side</Label>
              <div className="flex items-center gap-3">
                <UsersRound className="h-5 w-5 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  {[4, 5, 6, 7, 8].map((size) => (
                    <Button
                      key={size}
                      type="button"
                      variant={editTeamSize === size ? "default" : "outline"}
                      size="sm"
                      className="w-10 h-10"
                      onClick={() => {
                        setEditTeamSize(size);
                        // Ensure min doesn't exceed max
                        if (editMinPlayersPerSide > size) {
                          setEditMinPlayersPerSide(size);
                        }
                      }}
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Target team size for auto-generating balanced teams
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="min-players">Minimum Players Per Side</Label>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  {[2, 3, 4, 5, 6, 7, 8].filter(n => n <= editTeamSize).map((size) => (
                    <Button
                      key={size}
                      type="button"
                      variant={editMinPlayersPerSide === size ? "default" : "outline"}
                      size="sm"
                      className="w-10 h-10"
                      onClick={() => setEditMinPlayersPerSide(size)}
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                No team can have fewer than this many players
              </p>
            </div>

            {/* Minutes Per Half */}
            <div className="space-y-2">
              <Label htmlFor="minutes-per-half">Minutes Per Half</Label>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  {[5, 7, 10, 12, 15, 20].map((mins) => (
                    <Button
                      key={mins}
                      type="button"
                      variant={editMinutesPerHalf === mins ? "default" : "outline"}
                      size="sm"
                      className="w-10 h-10"
                      onClick={() => setEditMinutesPerHalf(mins)}
                    >
                      {mins}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Default game timer duration per half
              </p>
            </div>

            {/* Bib Colors Section */}
            <div className="space-y-3">
              <Label>Available Bib Colors</Label>
              <p className="text-xs text-muted-foreground">
                Select which bib colors are available for matches
              </p>
              
              {/* Current colors */}
              <div className="flex flex-wrap gap-2">
                {editBibColors.map((color) => (
                  <div
                    key={color}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full border"
                    style={{ borderColor: color }}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs">{getColorName(color)}</span>
                    <button
                      type="button"
                      onClick={() => removeBibColor(color)}
                      className="ml-1 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {editBibColors.length === 0 && (
                  <span className="text-xs text-muted-foreground">No colors selected</span>
                )}
              </div>

              {/* Add color presets */}
              <div className="flex flex-wrap gap-2">
                {BIB_COLOR_PRESETS.filter(p => !editBibColors.includes(p.value)).map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => addBibColor(preset.value)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-dashed hover:border-solid hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ backgroundColor: preset.value }}
                    />
                    <span className="text-xs text-muted-foreground">{preset.name}</span>
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
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
