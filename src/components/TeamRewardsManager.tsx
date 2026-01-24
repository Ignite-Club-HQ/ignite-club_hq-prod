import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Gift, Loader2, Plus, Pencil, Trash2, Info, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogClose,
} from "@/components/ui/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface TeamReward {
  id: string;
  club_id: string;
  team_id: string | null;
  name: string;
  description: string | null;
  points_required: number;
  is_active: boolean;
  reward_type: string;
  created_at: string;
}

interface TeamRewardsManagerProps {
  teamId: string;
  clubId: string;
  disableTeamOverrides?: boolean;
}

export default function TeamRewardsManager({ teamId, clubId, disableTeamOverrides = false }: TeamRewardsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<TeamReward | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsRequired, setPointsRequired] = useState(10);

  // Fetch team-specific POM reward (if exists)
  const { data: teamReward, isLoading: isTeamRewardLoading } = useQuery({
    queryKey: ["team-pom-reward", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .eq("team_id", teamId)
        .eq("reward_type", "player_of_match")
        .maybeSingle();
      if (error) throw error;
      return data as TeamReward | null;
    },
  });

  // Fetch club-level POM reward (fallback/default)
  const { data: clubReward, isLoading: isClubRewardLoading } = useQuery({
    queryKey: ["club-pom-reward", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .is("team_id", null)
        .eq("reward_type", "player_of_match")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as TeamReward | null;
    },
  });

  const isLoading = isTeamRewardLoading || isClubRewardLoading;

  // Create team-specific reward
  const createMutation = useMutation({
    mutationFn: async (reward: { name: string; description: string; points_required: number }) => {
      const { error } = await supabase.from("club_rewards").insert({
        club_id: clubId,
        team_id: teamId,
        name: reward.name,
        description: reward.description || null,
        points_required: reward.points_required,
        reward_type: "player_of_match",
        is_default: false,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-reward", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-reward", clubId, teamId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Team reward created" });
    },
    onError: () => {
      toast({ title: "Failed to create reward", variant: "destructive" });
    },
  });

  // Update team-specific reward
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name: string; description: string; points_required: number }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({
          name: updates.name,
          description: updates.description || null,
          points_required: updates.points_required,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-reward", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-reward", clubId, teamId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Team reward updated" });
    },
    onError: () => {
      toast({ title: "Failed to update reward", variant: "destructive" });
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-reward", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-reward", clubId, teamId] });
    },
  });

  // Delete team-specific reward
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("club_rewards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-reward", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-reward", clubId, teamId] });
      toast({ title: "Team reward deleted - club default will now apply" });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setPointsRequired(10);
    setEditingReward(null);
  };

  const handleOpenDialog = (reward?: TeamReward) => {
    if (reward) {
      setEditingReward(reward);
      setName(reward.name);
      setDescription(reward.description || "");
      setPointsRequired(reward.points_required);
    } else {
      resetForm();
      // Pre-fill from club default if available
      if (clubReward) {
        setName(clubReward.name + " (Team)");
        setDescription(clubReward.description || "");
        setPointsRequired(clubReward.points_required);
      }
    }
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Please enter a reward name", variant: "destructive" });
      return;
    }
    if (editingReward) {
      updateMutation.mutate({
        id: editingReward.id,
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
      });
    }
  };

  const activeReward = teamReward || clubReward;
  const isUsingClubDefault = !teamReward && !!clubReward;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <span className="font-medium">Player of the Match Reward</span>
        </div>
        {!teamReward && !disableTeamOverrides && (
          <Button size="sm" variant="outline" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-1" />
            Override Club Default
          </Button>
        )}
      </div>

      {disableTeamOverrides && !teamReward && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Team-specific rewards are disabled by your club admin. The club default reward is used for all teams.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeReward ? (
        <Card className={isUsingClubDefault ? "border-dashed" : ""}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Trophy className="h-5 w-5 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{activeReward.name}</span>
                    {isUsingClubDefault && (
                      <Badge variant="outline" className="text-xs">
                        Club Default
                      </Badge>
                    )}
                    {teamReward && (
                      <Badge variant="secondary" className="text-xs">
                        Team Override
                      </Badge>
                    )}
                  </div>
                  {activeReward.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      {activeReward.description}
                    </p>
                  )}
                  {/* POM rewards are awarded by selection, not points-based */}
                </div>
              </div>

              {/* Actions for team-specific reward */}
              {teamReward && (
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={teamReward.is_active}
                    onCheckedChange={(checked) =>
                      toggleActiveMutation.mutate({ id: teamReward.id, isActive: checked })
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleOpenDialog(teamReward)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Team Reward?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete the team-specific reward override. The club default reward will be used instead.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(teamReward.id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No Player of the Match reward is configured. Ask your club admin to set one up in Club Rewards, or create a team-specific reward.
          </AlertDescription>
        </Alert>
      )}

      {/* Create/Edit Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              {editingReward ? "Edit Team Reward" : "Create Team Reward"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reward-name">Reward Name</Label>
              <Input
                id="reward-name"
                placeholder="e.g., Free Ice Cream"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reward-description">Description (optional)</Label>
              <Textarea
                id="reward-description"
                placeholder="What does the player get?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* POM rewards are awarded by selection, not points-based - no points field needed */}
          </div>

          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </ResponsiveDialogClose>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingReward ? "Save Changes" : "Create Reward"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
