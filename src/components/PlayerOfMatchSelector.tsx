import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
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
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { recordPointsHistory } from "@/lib/pointsHistory";

interface PlayerOfMatchSelectorProps {
  eventId: string;
  clubId: string;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
  childrenOnTeam?: any[];
}

export default function PlayerOfMatchSelector({
  eventId,
  clubId,
  teamId,
  isAdmin,
  rsvps,
  childrenOnTeam = [],
}: PlayerOfMatchSelectorProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any | null>(null);

  // Fetch current player of match
  const { data: playerOfMatch, isLoading } = useQuery({
    queryKey: ["player-of-match", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_of_match")
        .select(`
          *,
          children:child_id (id, name)
        `)
        .eq("event_id", eventId)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;

      // Fetch profile separately if user_id exists
      let profile = null;
      if (data.user_id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .eq("id", data.user_id)
          .single();
        profile = profileData;
      }

      return { ...data, profiles: profile };
    },
  });

  // Fetch POM rewards - team-specific first, then club-level fallback
  const { data: pomRewards = [] } = useQuery({
    queryKey: ["pom-rewards", clubId, teamId],
    queryFn: async () => {
      // First try team-specific rewards
      if (teamId) {
        const { data: teamRewards, error: teamError } = await supabase
          .from("club_rewards")
          .select("*")
          .eq("club_id", clubId)
          .eq("team_id", teamId)
          .eq("reward_type", "player_of_match")
          .eq("is_active", true)
          .order("created_at", { ascending: true });
        
        if (!teamError && teamRewards && teamRewards.length > 0) {
          return teamRewards;
        }
      }
      
      // Fall back to club-level rewards (team_id is null)
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .is("team_id", null)
        .eq("reward_type", "player_of_match")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Use selected reward or default to first available
  const activePomReward = selectedReward || (pomRewards.length === 1 ? pomRewards[0] : null);

  // Award POM mutation
  const awardMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
      // Points to award - 0 if no reward configured
      const rewardToUse = activePomReward;
      const pointsToAward = rewardToUse?.points_required || 0;

      // Insert player of match record
      const { error: pomError } = await supabase.from("player_of_match").insert({
        event_id: eventId,
        user_id: userId || null,
        child_id: childId || null,
        awarded_by: user!.id,
        points_awarded: pointsToAward,
      } as any);

      if (pomError) throw pomError;

      // Only award points if there's a reward configured
      if (pointsToAward > 0) {
        if (userId) {
          // Atomic points increment
          const { data: newBalance, error: updateError } = await supabase.rpc('increment_ignite_points', {
            _user_id: userId,
            _amount: pointsToAward,
          });

          if (updateError) throw updateError;

          const balanceAfter = newBalance || 0;
          const previousPoints = balanceAfter - pointsToAward;

          // Record in points history
          await recordPointsHistory({
            userId,
            clubId,
            amount: pointsToAward,
            balanceAfter,
            sourceType: 'player_of_match',
            sourceId: eventId,
            description: 'Player of the Match award',
            createdBy: user!.id,
          });

          // Check reward threshold
          const { checkRewardThreshold } = await import("@/lib/rewardThresholdCheck");
          const rewardName = await checkRewardThreshold({
            userId,
            clubId,
            previousPoints,
            newPoints: balanceAfter,
          });

          // Send notification with points
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "player_of_match",
            message: rewardName
              ? `🏆 Congratulations! You were selected as Player of the Match and earned ${pointsToAward} points! 🎁 Reward unlocked: ${rewardName}!`
              : `🏆 Congratulations! You were selected as Player of the Match and earned ${pointsToAward} points!`,
            related_id: eventId,
          });
        } else if (childId) {
          // Atomic child points increment
          const { data: childNewBalance, error: childUpdateError } = await supabase.rpc('increment_child_ignite_points', {
            _child_id: childId,
            _amount: pointsToAward,
          });

          if (childUpdateError) throw childUpdateError;

          const childBalanceAfter = childNewBalance || 0;
          const previousChildPoints = childBalanceAfter - pointsToAward;

          // Get child info for notification
          const { data: child } = await supabase
            .from("children")
            .select("parent_id, name")
            .eq("id", childId)
            .single();

          // Record in points history for child
          await recordPointsHistory({
            childId,
            clubId,
            amount: pointsToAward,
            balanceAfter: childBalanceAfter,
            sourceType: 'player_of_match',
            sourceId: eventId,
            description: `Player of the Match award for ${child?.name}`,
            createdBy: user!.id,
          });

          // Check reward threshold for child
          const { checkRewardThreshold: checkChildReward } = await import("@/lib/rewardThresholdCheck");
          const childRewardName = await checkChildReward({
            childId,
            clubId,
            previousPoints: previousChildPoints,
            newPoints: childBalanceAfter,
          });

          // Notify parent with points
          if (child?.parent_id) {
            await supabase.from("notifications").insert({
              user_id: child.parent_id,
              type: "player_of_match",
              message: childRewardName
                ? `🏆 ${child.name} was selected as Player of the Match and earned ${pointsToAward} points! 🎁 Reward unlocked: ${childRewardName}!`
                : `🏆 ${child.name} was selected as Player of the Match and earned ${pointsToAward} points!`,
              related_id: eventId,
            });
          }
        }
      } else {
        // Send notification without points
        if (userId) {
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "player_of_match",
            message: `🏆 Congratulations! You were selected as Player of the Match!`,
            related_id: eventId,
          });
        } else if (childId) {
          const { data: child } = await supabase
            .from("children")
            .select("parent_id, name")
            .eq("id", childId)
            .single();

          if (child?.parent_id) {
            await supabase.from("notifications").insert({
              user_id: child.parent_id,
              type: "player_of_match",
              message: `🏆 ${child.name} was selected as Player of the Match!`,
              related_id: eventId,
            });
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-of-match", eventId] });
      setSelectDialogOpen(false);
      toast({ title: "Player of the Match awarded! 🏆" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to award Player of the Match", variant: "destructive" });
    },
  });

  // Remove POM mutation
  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!playerOfMatch) return;

      const pointsToDeduct = Number((playerOfMatch as any).points_awarded) || 0;

      // Deduct points
      if (playerOfMatch.user_id) {
        // Atomic deduction
        const { data: newBalance } = await supabase.rpc('increment_ignite_points', {
          _user_id: playerOfMatch.user_id,
          _amount: -pointsToDeduct,
        });

        if (pointsToDeduct > 0) {
          await recordPointsHistory({
            userId: playerOfMatch.user_id,
            clubId,
            amount: -pointsToDeduct,
            balanceAfter: newBalance || 0,
            sourceType: 'pom_removed',
            sourceId: eventId,
            description: 'Player of the Match award removed',
            createdBy: user!.id,
          });
        }
      } else if (playerOfMatch.child_id) {
        // Atomic deduction for child
        const { data: childNewBalance } = await supabase.rpc('increment_child_ignite_points', {
          _child_id: playerOfMatch.child_id,
          _amount: -pointsToDeduct,
        });

        if (pointsToDeduct > 0) {
          await recordPointsHistory({
            childId: playerOfMatch.child_id,
            clubId,
            amount: -pointsToDeduct,
            balanceAfter: childNewBalance || 0,
            sourceType: 'pom_removed',
            sourceId: eventId,
            description: 'Player of the Match award removed',
            createdBy: user!.id,
          });
        }
      }

      // Delete POM record
      const { error } = await supabase
        .from("player_of_match")
        .delete()
        .eq("id", playerOfMatch.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-of-match", eventId] });
      setRemoveDialogOpen(false);
      toast({ title: "Player of the Match removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove Player of the Match", variant: "destructive" });
    },
  });

  // Fetch user_ids that have the 'player' role on this team so we can exclude
  // parents, coaches, admins etc. from the POM list. Children are always players.
  const { data: playerUserIds = [] } = useQuery({
    queryKey: ["team-player-user-ids", teamId],
    queryFn: async () => {
      if (!teamId) return [] as string[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("role", "player");
      if (error) throw error;
      return (data || []).map((r: any) => r.user_id);
    },
    enabled: !!teamId,
  });

  // Get eligible players (going RSVPs)
  const goingPlayers = rsvps?.filter((r) => r.status === "going") || [];
  const goingChildren = goingPlayers.filter((r) => r.child_id);
  const goingMembers = goingPlayers.filter(
    (r) => !r.child_id && r.user_id && playerUserIds.includes(r.user_id)
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Display current POM or award button
  return (
    <>
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5 text-amber-500" />
            Player of the Match
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {playerOfMatch ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-amber-500">
                  {playerOfMatch.profiles?.avatar_url && (
                    <AvatarImage src={playerOfMatch.profiles.avatar_url} />
                  )}
                  <AvatarFallback className="bg-amber-500/20 text-amber-600">
                    {(playerOfMatch.profiles?.display_name || playerOfMatch.children?.name || "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {playerOfMatch.profiles?.display_name || playerOfMatch.children?.name}
                    </span>
                    {playerOfMatch.child_id && (
                      <Badge variant="outline" className="text-xs">Child</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-amber-600">
                    <Star className="h-3 w-3 fill-current" />
                    <span>+{playerOfMatch.points_awarded} points</span>
                  </div>
                </div>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : isAdmin ? (
             <div className="space-y-2">
              {/* Reward selector when multiple POM rewards exist */}
              {pomRewards.length > 1 && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground mb-1.5">Select reward to give:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pomRewards.map((reward: any) => (
                      <Button
                        key={reward.id}
                        variant={selectedReward?.id === reward.id ? "default" : "outline"}
                        size="sm"
                        className="text-xs"
                        onClick={() => setSelectedReward(reward)}
                      >
                        <Trophy className="h-3 w-3 mr-1" />
                        {reward.name}
                        {reward.points_required > 0 && ` (+${reward.points_required}pts)`}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                onClick={() => setSelectDialogOpen(true)}
                disabled={goingPlayers.length === 0 || (pomRewards.length > 1 && !selectedReward)}
              >
                <Trophy className="h-4 w-4 mr-2" />
                Select Player of the Match
              </Button>
              {goingPlayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  No players RSVP'd as "Going" yet
                </p>
              )}
              {pomRewards.length === 0 && goingPlayers.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  No points reward configured. Add a "Player of the Match" reward in Club Rewards to award points.
                </p>
              )}
              {pomRewards.length > 1 && !selectedReward && goingPlayers.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Select a reward above before choosing a player
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Player of the Match selected yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Select POM Dialog */}
      <ResponsiveDialog open={selectDialogOpen} onOpenChange={setSelectDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="text-left border-b pb-4">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Select Player of the Match
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-4 space-y-2">
              {activePomReward ? (
                <p className="text-sm text-muted-foreground mb-4">
                  The selected player will receive <strong>{activePomReward.points_required} points</strong> and the "{activePomReward.name}" reward.
                </p>
              ) : pomRewards.length > 0 ? (
                <p className="text-sm text-muted-foreground mb-4">
                  Select the player who stood out this match. Points will be awarded based on the selected reward.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-4">
                  Select the player who stood out this match. No points reward is currently configured.
                </p>
              )}
              
              {/* Members */}
              {goingMembers.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => awardMutation.mutate({ userId: rsvp.user_id })}
                  disabled={awardMutation.isPending}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarImage src={rsvp.profiles?.avatar_url} />
                    <AvatarFallback>
                      {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.profiles?.display_name || "Unknown"}</span>
                  {awardMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {/* Children */}
              {goingChildren.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => awardMutation.mutate({ childId: rsvp.child_id })}
                  disabled={awardMutation.isPending}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarFallback className="bg-secondary">
                      {rsvp.children?.name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.children?.name || "Unknown"}</span>
                  <Badge variant="outline" className="ml-2 text-xs">Child</Badge>
                  {awardMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {goingPlayers.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No players have RSVP'd as "Going" yet
                </p>
              )}
            </div>
          </ScrollArea>
          <div className="p-4 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSelectDialogOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Remove POM Confirmation */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Player of the Match?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Player of the Match selection and deduct {playerOfMatch?.points_awarded} points from{" "}
              {playerOfMatch?.profiles?.display_name || playerOfMatch?.children?.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}