import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Gift, Loader2, CheckCircle2, Clock, ChevronRight, Star, Users, QrCode, Building2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RewardClaimQRDialog } from "@/components/RewardClaimQRDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useClubTheme } from "@/hooks/useClubTheme";
import { recordPointsHistory } from "@/lib/pointsHistory";

interface ClubReward {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  points_required: number;
  is_active: boolean;
  is_default: boolean;
  logo_url: string | null;
  qr_code_url: string | null;
  show_qr_code: boolean;
  sponsors?: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

interface RewardRedemption {
  id: string;
  reward_id: string;
  club_id: string;
  points_spent: number;
  status: string;
  redeemed_at: string;
  child_id: string | null;
  club_rewards: ClubReward | null;
  clubs: { name: string };
  children: { id: string; name: string } | null;
}

interface Child {
  id: string;
  name: string;
  ignite_points: number;
}

// Check localStorage instantly to prevent gradient flash before React hydrates
const getInitialThemeState = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    // Check for any cached theme data - means user has club theme active
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ignite-club-theme-data-')) {
        const data = localStorage.getItem(key);
        if (data) return true;
      }
    }
  } catch {
    // localStorage not available
  }
  return false;
};

export default function RewardRedemptionCard() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<ClubReward | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedRedemption, setSelectedRedemption] = useState<RewardRedemption | null>(null);
  const [selectedRedeemFor, setSelectedRedeemFor] = useState<string>("myself"); // "myself" or child_id
  
  // Use cached theme state to prevent gradient flash on initial render
  const [hasClubThemeCached] = useState(getInitialThemeState);
  const hasClubTheme = activeThemeData || hasClubThemeCached;

  // Check if app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch clubs user belongs to (filtered by active club if set)
  const { data: userClubs = [], isLoading: isLoadingClubs } = useQuery({
    queryKey: ["user-clubs-for-rewards", user?.id, activeClubFilter],
    staleTime: 5 * 60 * 1000, // 5 minutes - show cached data instantly
    queryFn: async () => {
      // If active club filter, only return that club
      if (activeClubFilter) {
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name, logo_url, points_display_name, points_icon_url")
          .eq("id", activeClubFilter)
          .single();

        if (!club) return [];

        // Fetch subscription for this club
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", activeClubFilter)
          .maybeSingle();

        const hasPro = subscription?.is_pro || subscription?.is_pro_football || 
                       subscription?.admin_pro_override || subscription?.admin_pro_football_override;
        return [{ ...club, hasPro: !!hasPro }];
      }

      // Get club IDs from user roles (direct club membership or via teams)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, teams(club_id)")
        .eq("user_id", user!.id);

      if (!roles) return [];

      // Collect all club IDs
      const clubIds = new Set<string>();
      roles.forEach(role => {
        if (role.club_id) clubIds.add(role.club_id);
        if (role.teams?.club_id) clubIds.add(role.teams.club_id);
      });

      if (clubIds.size === 0) return [];

      // Fetch club details with subscription info
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, logo_url, points_display_name, points_icon_url")
        .in("id", Array.from(clubIds));

      // Fetch subscriptions for these clubs
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", Array.from(clubIds));

      // Merge subscription data with clubs
      const clubsWithPro = (clubs || []).map(club => {
        const sub = subscriptions?.find(s => s.club_id === club.id);
        const hasPro = sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override;
        return { ...club, hasPro: !!hasPro };
      });

      return clubsWithPro;
    },
    enabled: !!user,
  });

  // Fetch available rewards for selected club (exclude player_of_match rewards - those can only be awarded, not redeemed)
  const { data: availableRewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ["available-rewards", selectedClubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_rewards")
        .select("*, sponsors(id, name, logo_url)")
        .eq("club_id", selectedClubId!)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true });
      return (data || []) as ClubReward[];
    },
    enabled: !!selectedClubId,
  });

  // Fetch user's children
  const { data: children = [] } = useQuery({
    queryKey: ["user-children-for-rewards", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("children")
        .select("id, name, ignite_points")
        .eq("parent_id", user!.id)
        .order("name");
      return (data || []) as Child[];
    },
    enabled: !!user,
  });

  // Fetch user's redemption history (including children's) - filtered by active club if set
  const { data: redemptions = [] } = useQuery({
    queryKey: ["user-redemptions", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("reward_redemptions")
        .select(`
          id,
          reward_id,
          club_id,
          points_spent,
          status,
          redeemed_at,
          child_id,
          club_rewards (id, name, description, points_required, qr_code_url, show_qr_code),
          clubs (name),
          children (id, name)
        `)
        .eq("user_id", user!.id)
        .order("redeemed_at", { ascending: false })
        .limit(10);

      // Filter by active club if set
      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      }

      const { data } = await query;
      return (data || []) as RewardRedemption[];
    },
    enabled: !!user,
  });

  const redeemMutation = useMutation({
    mutationFn: async ({ reward, forChildId }: { reward: ClubReward; forChildId: string | null }) => {
      // Determine whose points to use
      let pointsSource: { id: string; points: number; isChild: boolean };
      let childName: string | null = null;
      
      if (forChildId) {
        const child = children.find(c => c.id === forChildId);
        if (!child) throw new Error("Child not found");
        if (child.ignite_points < reward.points_required) {
          throw new Error(`${child.name} doesn't have enough points`);
        }
        pointsSource = { id: forChildId, points: child.ignite_points, isChild: true };
        childName = child.name;
      } else {
        const currentPoints = profile?.ignite_points || 0;
        if (currentPoints < reward.points_required) {
          throw new Error("Not enough points");
        }
        pointsSource = { id: user!.id, points: currentPoints, isChild: false };
      }

      // Create redemption record with optional child_id
      const { error: redemptionError } = await supabase
        .from("reward_redemptions")
        .insert({
          user_id: user!.id,
          reward_id: reward.id,
          club_id: reward.club_id,
          points_spent: reward.points_required,
          child_id: forChildId,
        });

      if (redemptionError) throw redemptionError;

      // Deduct points atomically from the appropriate source
      if (pointsSource.isChild) {
        const { data: childNewBalance } = await supabase.rpc('increment_child_ignite_points', {
          _child_id: pointsSource.id,
          _amount: -reward.points_required,
        });

        await recordPointsHistory({
          childId: pointsSource.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: childNewBalance || 0,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      } else {
        const { data: newBalance } = await supabase.rpc('increment_ignite_points', {
          _user_id: user!.id,
          _amount: -reward.points_required,
        });

        await recordPointsHistory({
          userId: user!.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: newBalance || 0,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      }

      // Get club details for email
      const { data: club } = await supabase
        .from("clubs")
        .select("name, logo_url")
        .eq("id", reward.club_id)
        .single();

      // Get sponsor name if applicable
      let sponsorName: string | undefined;
      if (reward.sponsors?.name) {
        sponsorName = reward.sponsors.name;
      }

      // Send email notification
      try {
        await supabase.functions.invoke('send-reward-redeemed-email', {
          body: {
            recipientUserId: user!.id,
            rewardName: reward.name,
            pointsSpent: reward.points_required,
            remainingPoints: Math.max(0, pointsSource.points - reward.points_required),
            clubName: club?.name || 'Your Club',
            rewardDescription: reward.description,
            sponsorName,
            showQrCode: reward.show_qr_code,
            clubLogoUrl: club?.logo_url,
            rewardLogoUrl: reward.logo_url,
            redeemedForChildName: childName || undefined,
          },
        });
      } catch (emailErr) {
        console.error("Failed to send reward redeemed email:", emailErr);
        // Don't throw - redemption was still successful
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["user-children-for-rewards"] });
      refreshProfile();
      setConfirmDialogOpen(false);
      setSelectedReward(null);
      setSelectedRedeemFor("myself");
      toast({
        title: "Reward Redeemed!",
        description: "Show this to a club admin to claim your reward.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to redeem reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  // Mutation to mark reward as claimed
  const claimMutation = useMutation({
    mutationFn: async (redemption: { id: string; club_id: string; reward_name: string }) => {
      const { error } = await supabase
        .from("reward_redemptions")
        .update({
          status: "fulfilled",
          verified_at: new Date().toISOString(),
          verified_by: user!.id,
        })
        .eq("id", redemption.id);

      if (error) throw error;

      // Get claimer's name
      const { data: claimerProfile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .single();

      const claimerName = claimerProfile?.display_name || "Someone";

      // Notify club admins about the claim
      const { data: clubAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", redemption.club_id)
        .eq("role", "club_admin");

      if (clubAdmins && clubAdmins.length > 0) {
        const notifications = clubAdmins
          .filter(admin => admin.user_id !== user!.id)
          .map(admin => ({
            user_id: admin.user_id,
            type: "reward_claimed",
            message: `${claimerName} marked their "${redemption.reward_name}" reward as claimed`,
            related_id: redemption.id,
          }));

        if (notifications.length > 0) {
          await supabase.from("notifications").insert(notifications);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-redemptions"] });
      setClaimDialogOpen(false);
      setSelectedRedemption(null);
      toast({
        title: "Reward Claimed!",
        description: "The reward has been marked as fulfilled.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to claim reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleSelectReward = (reward: ClubReward) => {
    setSelectedReward(reward);
    setSelectedClubId(null); // Close the rewards dialog first
    // Use timeout to ensure the first dialog closes before opening the second
    setTimeout(() => {
      setConfirmDialogOpen(true);
    }, 100);
  };

  const handleConfirmRedeem = () => {
    if (selectedReward) {
      const forChildId = selectedRedeemFor === "myself" ? null : selectedRedeemFor;
      redeemMutation.mutate({ reward: selectedReward, forChildId });
    }
  };

  const handleClaimReward = (redemption: RewardRedemption) => {
    setSelectedRedemption(redemption);
    setClaimDialogOpen(true);
  };

  const handleConfirmClaim = () => {
    if (selectedRedemption) {
      claimMutation.mutate({
        id: selectedRedemption.id,
        club_id: selectedRedemption.club_id,
        reward_name: selectedRedemption.club_rewards?.name || "reward",
      });
    }
  };

  const currentPoints = profile?.ignite_points || 0;
  const pendingRedemptions = redemptions.filter(r => r.status === "pending");
  const hasClubs = userClubs.length > 0;
  const isLoadingClubsWithNoCache = isLoadingClubs && userClubs.length === 0;


  // If user has a pending redemption, show it prominently
  if (pendingRedemptions.length > 0) {
    const latestRedemption = pendingRedemptions[0];
    return (
      <>
        <Card className={`${hasClubTheme ? 'gradient-themed' : 'gradient-emerald'} border-0 overflow-hidden`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {(userClubs[0] as any)?.points_icon_url && (
                  <img src={(userClubs[0] as any).points_icon_url} alt="" className="h-6 w-6 rounded object-cover" />
                )}
                {!(userClubs[0] as any)?.points_icon_url && <Gift className="h-6 w-6 text-primary-foreground" />}
                <span className="font-semibold text-primary-foreground">{(userClubs[0] as any)?.points_display_name || 'Ignite Points'}</span>
              </div>
              <span className="text-3xl font-bold text-primary-foreground">
                {currentPoints}
              </span>
            </div>
            
            <div className="bg-amber-500/30 border border-amber-400/50 rounded-lg p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-4xl">🎁</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-amber-300" />
                      <span className="font-bold text-lg text-primary-foreground">
                        Reward Ready!
                      </span>
                    </div>
                    <p className="font-medium text-primary-foreground mt-1">
                      {latestRedemption.club_rewards?.name}
                    </p>
                    {latestRedemption.child_id && latestRedemption.children && (
                      <p className="text-sm text-primary-foreground/90">
                        For {latestRedemption.children.name}
                      </p>
                    )}
                    <p className="text-sm text-primary-foreground/90">
                      Ready to mark as claimed
                    </p>
                  </div>
                  <Badge className="bg-amber-400 text-amber-900">Pending</Badge>
                </div>
                
                <div className="flex gap-2">
                  {/* Show QR button if reward has QR code configured */}
                  {latestRedemption.club_rewards?.show_qr_code && latestRedemption.club_rewards?.qr_code_url && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0"
                      onClick={() => {
                        setSelectedRedemption(latestRedemption);
                        setQrDialogOpen(true);
                      }}
                    >
                      <QrCode className="h-4 w-4 mr-2" />
                      Show QR Code
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`${latestRedemption.club_rewards?.show_qr_code && latestRedemption.club_rewards?.qr_code_url ? 'flex-1' : 'w-full'} bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0`}
                    onClick={() => handleClaimReward(latestRedemption)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Claimed
                  </Button>
                </div>
              </div>
            </div>

            {pendingRedemptions.length > 1 && (
              <p className="text-xs text-primary-foreground/70 mt-2">
                +{pendingRedemptions.length - 1} more pending reward{pendingRedemptions.length > 2 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Claim Confirmation Dialog */}
        <AlertDialog 
          open={claimDialogOpen} 
          onOpenChange={(open) => {
            if (!claimMutation.isPending) {
              setClaimDialogOpen(open);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mark Reward as Claimed?</AlertDialogTitle>
              <AlertDialogDescription>
                Confirm that <strong>{selectedRedemption?.club_rewards?.name}</strong> has been given to the member.
                <br /><br />
                This will mark the reward as fulfilled and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={claimMutation.isPending}>Cancel</AlertDialogCancel>
              <Button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleConfirmClaim();
                }}
                disabled={claimMutation.isPending}
              >
                {claimMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {claimMutation.isPending ? "Confirming..." : "Confirm Claimed"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* QR Code Dialog */}
        {selectedRedemption && (
          <RewardClaimQRDialog
            open={qrDialogOpen}
            onOpenChange={setQrDialogOpen}
            rewardName={selectedRedemption.club_rewards?.name || "Reward"}
            clubName={selectedRedemption.clubs?.name || "Club"}
            redemptionId={selectedRedemption.id}
            qrCodeUrl={selectedRedemption.club_rewards?.qr_code_url || null}
            userName={profile?.display_name || undefined}
            userId={user?.id || ""}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Card className={`${hasClubTheme ? 'gradient-themed' : 'gradient-emerald'} border-0 overflow-hidden`}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {(userClubs[0] as any)?.points_icon_url && (
                <img src={(userClubs[0] as any).points_icon_url} alt="" className="h-6 w-6 rounded object-cover" />
              )}
              {!(userClubs[0] as any)?.points_icon_url && <Gift className="h-6 w-6 text-primary-foreground" />}
              <span className="font-semibold text-primary-foreground">{(userClubs[0] as any)?.points_display_name || 'Ignite Points'}</span>
            </div>
            <span className="text-3xl font-bold text-primary-foreground">
              {currentPoints}
            </span>
          </div>
          
          {/* Show children's points if any */}
          {children.length > 0 && (
            <div className="mb-4 space-y-1">
              {children.map(child => (
                <div key={child.id} className="flex items-center justify-between text-sm text-primary-foreground/80">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {child.name}
                  </span>
                  <span className="font-medium">{child.ignite_points} pts</span>
                </div>
              ))}
            </div>
          )}
          
          {isLoadingClubsWithNoCache ? (
            <div className="bg-primary-foreground/10 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                <p className="text-sm text-primary-foreground">Loading clubs...</p>
              </div>
            </div>
          ) : hasClubs ? (
            (() => {
              // In club mode with a single Pro club, show a simple "Browse Rewards" button
              const proClubs = userClubs.filter((club: any) => isAppAdmin || club.hasPro);
              const isSingleClubMode = activeClubFilter && proClubs.length === 1;
              
              if (isSingleClubMode) {
                const club = proClubs[0];
                return (
                  <div className="space-y-3">
                    <Button
                      className="w-full bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0"
                      variant="secondary"
                      onClick={() => setSelectedClubId(club.id)}
                    >
                      <Gift className="h-4 w-4 mr-2" />
                      Browse Rewards
                      <ChevronRight className="h-4 w-4 ml-auto" />
                    </Button>
                  </div>
                );
              }
              
              // Default: show club selection grid
              return (
                <div className="space-y-3">
                  <p className="text-sm text-primary-foreground/90">
                    Select a club to view available rewards:
                  </p>
                  <div className="grid gap-2">
                    {userClubs.map((club: any) => {
                      const clubHasPro = isAppAdmin || club.hasPro;
                      return (
                        <button
                          key={club.id}
                          onClick={() => clubHasPro ? setSelectedClubId(club.id) : null}
                          disabled={!clubHasPro}
                          className={`flex items-center justify-between p-3 rounded-lg transition-colors text-left ${
                            clubHasPro 
                              ? "bg-primary-foreground/10 hover:bg-primary-foreground/20 cursor-pointer" 
                              : "bg-primary-foreground/5 cursor-not-allowed opacity-70"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-primary-foreground">{club.name}</span>
                            {!clubHasPro && (
                              <Badge variant="outline" className="text-xs bg-primary-foreground/10 border-primary-foreground/30 text-primary-foreground">
                                <Lock className="h-3 w-3 mr-1" />
                                Pro
                              </Badge>
                            )}
                          </div>
                          {clubHasPro ? (
                            <ChevronRight className="h-4 w-4 text-primary-foreground/70" />
                          ) : (
                            <Lock className="h-4 w-4 text-primary-foreground/50" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="bg-primary-foreground/10 rounded-lg p-3">
              <p className="text-sm text-primary-foreground">
                Join a club to start earning and redeeming rewards!
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Club Rewards Dialog */}
      <Dialog open={!!selectedClubId} onOpenChange={() => setSelectedClubId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Available Rewards
            </DialogTitle>
            <DialogDescription>
              {children.length > 0 
                ? `You have ${currentPoints} points (+ children's points)`
                : `You have ${currentPoints} points to spend`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 pt-2">
            {rewardsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableRewards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No rewards available yet. Check back later!
              </p>
            ) : (
              <>
                {/* Featured reward first */}
                {availableRewards.filter(r => r.is_default).map((reward) => {
                  const canAffordSelf = currentPoints >= reward.points_required;
                  const canAffordAnyChild = children.some(c => c.ignite_points >= reward.points_required);
                  const canAfford = canAffordSelf || canAffordAnyChild;
                  return (
                    <div
                      key={reward.id}
                      className={`p-4 rounded-lg border-2 ${
                        canAfford 
                          ? "border-yellow-500 bg-yellow-500/10" 
                          : "border-yellow-500/50 bg-yellow-500/5 opacity-70"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Featured Reward</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        {reward.logo_url && (
                          <img src={reward.logo_url} alt={reward.name || "Reward logo"} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{reward.name}</span>
                            <Badge variant="outline">{reward.points_required} pts</Badge>
                          </div>
                          {reward.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {reward.description}
                            </p>
                          )}
                          {reward.sponsors && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              Sponsored by {reward.sponsors.name}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={!canAfford}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectReward(reward);
                          }}
                        >
                          {canAfford ? "Redeem" : `Need ${reward.points_required} pts`}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Other rewards */}
                {availableRewards.filter(r => !r.is_default).map((reward) => {
                  const canAffordSelf = currentPoints >= reward.points_required;
                  const canAffordAnyChild = children.some(c => c.ignite_points >= reward.points_required);
                  const canAfford = canAffordSelf || canAffordAnyChild;
                  return (
                    <div
                      key={reward.id}
                      className={`p-4 rounded-lg border ${
                        canAfford 
                          ? "border-primary/50 bg-primary/5" 
                          : "border-muted bg-muted/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {reward.logo_url && (
                          <img src={reward.logo_url} alt={reward.name || "Reward logo"} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{reward.name}</span>
                            <Badge variant="outline">{reward.points_required} pts</Badge>
                          </div>
                          {reward.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {reward.description}
                            </p>
                          )}
                          {reward.sponsors && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              Sponsored by {reward.sponsors.name}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={!canAfford}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectReward(reward);
                          }}
                        >
                          {canAfford ? "Redeem" : `Need ${reward.points_required} pts`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Redemption Dialog */}
      <AlertDialog 
        open={confirmDialogOpen} 
        onOpenChange={(open) => {
          if (!redeemMutation.isPending) {
            setConfirmDialogOpen(open);
            if (!open) setSelectedRedeemFor("myself");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem Reward?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  You're about to redeem <strong>{selectedReward?.name}</strong> for{" "}
                  <strong>{selectedReward?.points_required} points</strong>.
                </p>
                
                {children.filter(c => c.ignite_points >= (selectedReward?.points_required || 0)).length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="redeem-for" className="text-foreground">Redeem for:</Label>
                    <Select value={selectedRedeemFor} onValueChange={setSelectedRedeemFor}>
                      <SelectTrigger id="redeem-for">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="myself">
                          <div className="flex items-center gap-2">
                            <span>Myself</span>
                            <Badge variant="outline" className="text-xs">{currentPoints} pts</Badge>
                          </div>
                        </SelectItem>
                        {children.map(child => (
                          <SelectItem key={child.id} value={child.id}>
                            <div className="flex items-center gap-2">
                              <Users className="h-3 w-3" />
                              <span>{child.name}</span>
                              <Badge variant="outline" className="text-xs">{child.ignite_points} pts</Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedRedeemFor !== "myself" && (
                      <p className="text-xs text-muted-foreground">
                        Points will be deducted from {children.find(c => c.id === selectedRedeemFor)?.name}'s balance.
                      </p>
                    )}
                  </div>
                )}
                
                <p className="text-muted-foreground">
                  After redemption, show this reward to a club admin to claim it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeemMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleConfirmRedeem();
              }}
              disabled={redeemMutation.isPending || (
                selectedRedeemFor === "myself" 
                  ? currentPoints < (selectedReward?.points_required || 0)
                  : (children.find(c => c.id === selectedRedeemFor)?.ignite_points || 0) < (selectedReward?.points_required || 0)
              )}
            >
              {redeemMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {redeemMutation.isPending ? "Redeeming..." : "Confirm Redemption"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
