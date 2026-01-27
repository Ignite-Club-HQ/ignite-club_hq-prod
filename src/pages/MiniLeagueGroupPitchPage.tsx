import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Users, Play, Pause, RotateCcw, Clock, Loader2, ClipboardList, Plus, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetFooter
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface GroupDuty {
  id: string;
  name: string;
  assigned_to: string | null;
  status: "pending" | "confirmed" | "completed";
  points: number;
  assignee?: { display_name: string } | null;
}

interface GroupPlayer {
  id: string;
  name: string;
  ability_rating: number;
}

export default function MiniLeagueGroupPitchPage() {
  const { id: leagueId, sessionId, groupId } = useParams<{ 
    id: string; 
    sessionId: string; 
    groupId: string;
  }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isDutySheetOpen, setIsDutySheetOpen] = useState(false);
  const [newDutyName, setNewDutyName] = useState("");

  // Fetch group details
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["mini-league-group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_groups")
        .select(`
          *,
          session:mini_league_sessions(
            id, session_date, start_time, end_time,
            mini_league:mini_leagues(id, name, team_size)
          )
        `)
        .eq("id", groupId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!groupId,
  });

  // Fetch group players
  const { data: players } = useQuery({
    queryKey: ["mini-league-group-players", groupId],
    queryFn: async () => {
      const { data: groupPlayers, error: gpError } = await supabase
        .from("mini_league_group_players")
        .select("player_id")
        .eq("group_id", groupId!);
      if (gpError) throw gpError;
      
      if (!groupPlayers?.length) return [];
      
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating")
        .in("id", groupPlayers.map(gp => gp.player_id));
      if (playersError) throw playersError;
      
      return playersData as GroupPlayer[];
    },
    enabled: !!groupId,
  });

  // Fetch group duties
  const { data: duties, isLoading: dutiesLoading } = useQuery({
    queryKey: ["mini-league-group-duties", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_group_duties")
        .select("*, assignee:profiles!mini_league_group_duties_assigned_to_fkey(display_name)")
        .eq("group_id", groupId!)
        .order("created_at");
      if (error) throw error;
      return data as GroupDuty[];
    },
    enabled: !!groupId,
  });

  // Fetch league parents for duty assignment
  const { data: leagueParents } = useQuery({
    queryKey: ["mini-league-parents", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", leagueId!)
        .not("parent_user_id", "is", null);
      if (error) throw error;
      
      const parentIds = [...new Set(data?.map(p => p.parent_user_id).filter(Boolean))];
      if (!parentIds.length) return [];
      
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", parentIds);
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
    enabled: !!leagueId,
  });

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  // Load saved timer state
  useEffect(() => {
    if (group?.timer_state && typeof group.timer_state === 'object') {
      const timerState = group.timer_state as { elapsed?: number; running?: boolean };
      if (timerState.elapsed) setElapsedTime(timerState.elapsed);
      if (timerState.running) setIsTimerRunning(timerState.running);
    }
  }, [group?.timer_state]);

  // Save timer state
  const saveTimerMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mini_league_groups")
        .update({ 
          timer_state: { elapsed: elapsedTime, running: isTimerRunning } 
        })
        .eq("id", groupId!);
      if (error) throw error;
    },
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("mini_league_group_duties").insert({
        group_id: groupId!,
        name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-group-duties", groupId] });
      setNewDutyName("");
      toast.success("Duty added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Assign duty mutation
  const assignDutyMutation = useMutation({
    mutationFn: async ({ dutyId, assignedTo }: { dutyId: string; assignedTo: string | null }) => {
      const { error } = await supabase
        .from("mini_league_group_duties")
        .update({ assigned_to: assignedTo, status: assignedTo ? "confirmed" : "pending" })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-group-duties", groupId] });
      toast.success("Duty updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete duty mutation
  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase.from("mini_league_group_duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-group-duties", groupId] });
      toast.success("Duty removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTimerToggle = () => {
    setIsTimerRunning(!isTimerRunning);
    saveTimerMutation.mutate();
  };

  const handleTimerReset = () => {
    setIsTimerRunning(false);
    setElapsedTime(0);
    saveTimerMutation.mutate();
  };

  const handleAddDuty = () => {
    const trimmed = newDutyName.trim();
    if (!trimmed) {
      toast.error("Please enter a duty name");
      return;
    }
    addDutyMutation.mutate(trimmed);
  };

  if (groupLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Group not found</p>
      </div>
    );
  }

  const session = group.session as any;
  const miniLeague = session?.mini_league;

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate(`/mini-leagues/${leagueId}/sessions/${sessionId}`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{group.name}</h1>
          <p className="text-muted-foreground text-sm">
            {group.ability_band} • {group.pitch_name || "No pitch assigned"}
          </p>
        </div>
        <Badge variant="outline">
          <Users className="h-3.5 w-3.5 mr-1" />
          {players?.length || 0}
        </Badge>
      </div>

      {/* Session Info */}
      {session && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium">
                {format(parseISO(session.session_date), "EEE, MMM d")}
              </span>
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {session.start_time?.slice(0, 5)}
                {session.end_time && ` - ${session.end_time.slice(0, 5)}`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Game Timer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-4xl font-mono font-bold tabular-nums">
              {formatTime(elapsedTime)}
            </div>
            <div className="flex gap-2">
              <Button
                variant={isTimerRunning ? "secondary" : "default"}
                size="icon"
                onClick={handleTimerToggle}
              >
                {isTimerRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleTimerReset}
                disabled={elapsedTime === 0}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Players */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Players</CardTitle>
          <CardDescription>
            {players?.length || 0} players in this group
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {players?.map((player) => (
              <Badge key={player.id} variant="secondary" className="py-1.5 px-3">
                {player.name}
              </Badge>
            ))}
            {(!players || players.length === 0) && (
              <p className="text-sm text-muted-foreground">No players assigned</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Duties */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Duties</CardTitle>
              <CardDescription>
                {duties?.length || 0} duties for this group
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setIsDutySheetOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {dutiesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : duties?.length === 0 ? (
            <div className="text-center py-6">
              <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No duties assigned</p>
            </div>
          ) : (
            <div className="space-y-2">
              {duties?.map((duty) => (
                <div 
                  key={duty.id} 
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      duty.status === "completed" ? "bg-green-500" :
                      duty.status === "confirmed" ? "bg-primary" : "bg-muted-foreground"
                    }`} />
                    <div>
                      <p className="font-medium text-sm">{duty.name}</p>
                      {duty.assignee?.display_name && (
                        <p className="text-xs text-muted-foreground">
                          {duty.assignee.display_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Select
                      value={duty.assigned_to || "unassigned"}
                      onValueChange={(value) => assignDutyMutation.mutate({
                        dutyId: duty.id,
                        assignedTo: value === "unassigned" ? null : value,
                      })}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue placeholder="Assign" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {leagueParents?.map((parent) => (
                          <SelectItem key={parent.id} value={parent.id}>
                            {parent.display_name || "Unknown"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteDutyMutation.mutate(duty.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Duty Sheet */}
      <Sheet open={isDutySheetOpen} onOpenChange={setIsDutySheetOpen}>
        <SheetContent side="bottom" className="h-auto">
          <SheetHeader>
            <SheetTitle>Add Duty</SheetTitle>
            <SheetDescription>
              Create a duty for this group's session
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Duty Name</Label>
              <Input
                placeholder="e.g. Referee, First Aid, Setup"
                value={newDutyName}
                onChange={(e) => setNewDutyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddDuty()}
              />
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleAddDuty} disabled={addDutyMutation.isPending} className="w-full">
              {addDutyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Duty
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
