import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Users, Calendar, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface MiniLeague {
  id: string;
  name: string;
  description: string | null;
  team_size: number;
  club_id: string;
  created_at: string;
  club: {
    id: string;
    name: string;
  };
  _count?: {
    players: number;
    sessions: number;
  };
}

export default function MiniLeaguesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "", team_size: "5", club_id: "" });

  // Fetch clubs where user is admin
  const { data: adminClubs } = useQuery({
    queryKey: ["admin-clubs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("club_id, clubs!inner(id, name)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "app_admin"])
        .not("club_id", "is", null);
      
      if (error) throw error;
      
      // Dedupe by club_id
      const uniqueClubs = new Map();
      data?.forEach((r: any) => {
        if (r.clubs && !uniqueClubs.has(r.clubs.id)) {
          uniqueClubs.set(r.clubs.id, r.clubs);
        }
      });
      return Array.from(uniqueClubs.values());
    },
    enabled: !!user,
  });

  // Fetch mini leagues
  const { data: miniLeagues, isLoading } = useQuery({
    queryKey: ["mini-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select(`
          *,
          club:clubs(id, name)
        `)
        .order("created_at", { ascending: false });
      
      if (error) throw error;

      // Get counts for each league
      const leaguesWithCounts = await Promise.all(
        (data || []).map(async (league) => {
          const [playersResult, sessionsResult] = await Promise.all([
            supabase.from("mini_league_players").select("id", { count: "exact", head: true }).eq("mini_league_id", league.id),
            supabase.from("mini_league_sessions").select("id", { count: "exact", head: true }).eq("mini_league_id", league.id),
          ]);
          return {
            ...league,
            _count: {
              players: playersResult.count || 0,
              sessions: sessionsResult.count || 0,
            },
          };
        })
      );

      return leaguesWithCounts as MiniLeague[];
    },
    enabled: !!user,
  });

  // Create mini league mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof newLeague) => {
      const { error } = await supabase.from("mini_leagues").insert({
        name: data.name,
        description: data.description || null,
        team_size: parseInt(data.team_size),
        club_id: data.club_id,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-leagues"] });
      setIsCreateOpen(false);
      setNewLeague({ name: "", description: "", team_size: "5", club_id: "" });
      toast.success("Mini League created!");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCreate = () => {
    if (!newLeague.name.trim() || !newLeague.club_id) {
      toast.error("Please fill in required fields");
      return;
    }
    createMutation.mutate(newLeague);
  };

  const canCreate = (adminClubs?.length || 0) > 0;

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mini Leagues</h1>
          <p className="text-muted-foreground">Manage ability-based player groups</p>
        </div>
        {canCreate && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New League
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Mini League</DialogTitle>
                <DialogDescription>
                  Set up a new mini league with ability-based grouping
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="club">Club *</Label>
                  <Select value={newLeague.club_id} onValueChange={(v) => setNewLeague({ ...newLeague, club_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select club" />
                    </SelectTrigger>
                    <SelectContent>
                      {adminClubs?.map((club) => (
                        <SelectItem key={club.id} value={club.id}>
                          {club.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">League Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Saturday Morning League"
                    value={newLeague.name}
                    onChange={(e) => setNewLeague({ ...newLeague, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Optional description..."
                    value={newLeague.description}
                    onChange={(e) => setNewLeague({ ...newLeague, description: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team_size">Players per Group</Label>
                  <Select value={newLeague.team_size} onValueChange={(v) => setNewLeague({ ...newLeague, team_size: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4">4-a-side</SelectItem>
                      <SelectItem value="5">5-a-side</SelectItem>
                      <SelectItem value="6">6-a-side</SelectItem>
                      <SelectItem value="7">7-a-side</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : miniLeagues?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Mini Leagues Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first mini league to start grouping players by ability
            </p>
            {canCreate && (
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Mini League
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {miniLeagues?.map((league) => (
            <Card
              key={league.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(`/mini-leagues/${league.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{league.name}</CardTitle>
                    <CardDescription>{league.club?.name}</CardDescription>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {league._count?.players || 0} players
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {league._count?.sessions || 0} sessions
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
