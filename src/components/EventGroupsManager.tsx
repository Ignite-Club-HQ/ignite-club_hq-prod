import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, PlayCircle, Wand2, Loader2, X, ClipboardList, Copy } from "lucide-react";
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

interface EventGroup {
  id: string;
  name: string;
  ability_band: string | null;
  pitch_name: string | null;
  display_order: number;
  players: { id: string; name: string }[];
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

      // Fetch players for each group
      const groupsWithPlayers: EventGroup[] = [];
      for (const group of groupsData || []) {
        const { data: playerLinks } = await supabase
          .from("event_group_players")
          .select("player_id")
          .eq("group_id", group.id);
        
        const playerIds = playerLinks?.map(p => p.player_id) || [];
        let players: { id: string; name: string }[] = [];
        
        if (playerIds.length > 0) {
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("id, name")
            .in("id", playerIds);
          players = (playersData || []) as { id: string; name: string }[];
        }

        groupsWithPlayers.push({
          ...group,
          players,
        });
      }
      return groupsWithPlayers;
    },
    enabled: !!eventId,
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
      const { error } = await supabase.from("event_groups").insert({
        event_id: eventId,
        name: newGroupName.trim(),
        pitch_name: newPitchName.trim() || null,
        display_order: (groups?.length || 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsCreateOpen(false);
      setNewGroupName("");
      setNewPitchName("");
      toast.success("Group created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Auto-generate groups mutation
  const autoGenMutation = useMutation({
    mutationFn: async () => {
      if (!allPlayers || allPlayers.length === 0) {
        throw new Error("No players in this mini league");
      }

      // Sort by ability rating (already sorted)
      const sortedPlayers = [...allPlayers];
      
      // Create groups with balanced ability
      const groupNames = ["Group A", "Group B", "Group C", "Group D", "Group E", "Group F"];
      const abilityBands = ["High", "Medium", "Low"];
      
      // Create the groups first
      const groupIds: string[] = [];
      for (let i = 0; i < numGroups; i++) {
        const { data, error } = await supabase
          .from("event_groups")
          .insert({
            event_id: eventId,
            name: groupNames[i] || `Group ${i + 1}`,
            ability_band: abilityBands[Math.floor(i / Math.ceil(numGroups / 3))] || null,
            pitch_name: `Pitch ${i + 1}`,
            display_order: i + 1,
          })
          .select()
          .single();
        if (error) throw error;
        groupIds.push(data.id);
      }

      // Distribute players across groups (snake draft for balance)
      const playerGroups: string[][] = Array(numGroups).fill(null).map(() => []);
      sortedPlayers.forEach((player, index) => {
        const round = Math.floor(index / numGroups);
        const groupIndex = round % 2 === 0 
          ? index % numGroups 
          : numGroups - 1 - (index % numGroups);
        playerGroups[groupIndex].push(player.id);
      });

      // Insert player assignments
      for (let i = 0; i < numGroups; i++) {
        if (playerGroups[i].length > 0) {
          const assignments = playerGroups[i].map(playerId => ({
            group_id: groupIds[i],
            player_id: playerId,
          }));
          await supabase.from("event_group_players").insert(assignments);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsAutoGenOpen(false);
      toast.success(`${numGroups} groups created with balanced players`);
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
        // Create new group
        const { data: newGroup, error: createError } = await supabase
          .from("event_groups")
          .insert({
            event_id: eventId,
            name: prevGroup.name,
            ability_band: prevGroup.ability_band,
            pitch_name: prevGroup.pitch_name,
            display_order: prevGroup.display_order,
          })
          .select()
          .single();
        if (createError) throw createError;

        // Copy player assignments
        const { data: prevPlayers } = await supabase
          .from("event_group_players")
          .select("player_id")
          .eq("group_id", prevGroup.id);

        if (prevPlayers && prevPlayers.length > 0) {
          const assignments = prevPlayers.map(p => ({
            group_id: newGroup.id,
            player_id: p.player_id,
          }));
          await supabase.from("event_group_players").insert(assignments);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsCopyPreviousOpen(false);
      setSelectedPreviousEventId(null);
      toast.success("Groups copied from previous event");
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
        <h3 className="font-semibold">Breakout Groups</h3>
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
          {groups.map((group) => (
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
                <div className="flex flex-wrap gap-1 mb-3">
                  {group.players.map((player) => (
                    <Badge key={player.id} variant="secondary" className="text-xs">
                      {player.name}
                    </Badge>
                  ))}
                  {group.players.length === 0 && (
                    <span className="text-sm text-muted-foreground">No players assigned</span>
                  )}
                </div>
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
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No groups yet</p>
            {isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">
                Auto-generate balanced groups or create them manually
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Group Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent side="bottom" className="h-auto">
          <SheetHeader>
            <SheetTitle>Create Group</SheetTitle>
            <SheetDescription>Add a new breakout group for this session</SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Group Name</Label>
              <Input
                placeholder="e.g. Group A, U8 Tigers"
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
              Create Group
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Auto-Generate Dialog */}
      <Dialog open={isAutoGenOpen} onOpenChange={setIsAutoGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-Generate Groups</DialogTitle>
            <DialogDescription>
              Automatically create balanced groups based on player ability ratings
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Number of Groups</Label>
              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map((n) => (
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
              {allPlayers?.length || 0} players will be distributed across {numGroups} groups
              (~{Math.ceil((allPlayers?.length || 0) / numGroups)} per group)
            </p>
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
              Copy group assignments from a previous session
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
              Copy Groups
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
