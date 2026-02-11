import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Crown, Loader2, Ticket, Target, ArrowDown, Calendar, AlertCircle, Building2, Users, CreditCard, Clock } from "lucide-react";
import { isPast, parseISO, format, addMonths, addYears, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const PRO_FEATURES = [
  "Club Chat (club-wide messaging)",
  "Ignite Points & Rewards System",
  "Photo & Media Uploads",
  "Vault File Storage",
  "Subfolder Organization",
  "Duty Point Awards",
  "Priority Support",
];

const PRO_FOOTBALL_FEATURES = [
  ...PRO_FEATURES,
  "Soccer Pitch Board",
  "Tactical Formations",
  "Player Positioning",
  "Drawing Tools & Arrows",
  "Formation Saving",
  "Game Timer",
  "Automated Substitutions",
];

// Club pricing in AUD
const CLUB_PRICING = {
  pro: {
    starter: { monthly: 99, teamLimit: 10 },
    standard: { monthly: 149, teamLimit: 20 },
    unlimited: { monthly: 199, teamLimit: null },
  },
  proFootball: {
    starter: { monthly: 149, teamLimit: 10 },
    standard: { monthly: 229, teamLimit: 20 },
    unlimited: { monthly: 299, teamLimit: null },
  },
};

// Check if club sport is soccer/football
const isSoccerClub = (sport: string | null | undefined): boolean => {
  if (!sport) return false;
  const lowerSport = sport.toLowerCase();
  return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
};

type PlanTier = "starter" | "standard" | "unlimited";

export default function ClubUpgradePage() {
  const { clubId } = useParams<{ clubId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [promoCode, setPromoCode] = useState("");
  const [promoCodeFootball, setPromoCodeFootball] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [selectedTab, setSelectedTab] = useState("pro");
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>("starter");
  const [selectedPlanFootball, setSelectedPlanFootball] = useState<PlanTier>("starter");
  const [isAnnualPro, setIsAnnualPro] = useState(false);
  const [isAnnualProFootball, setIsAnnualProFootball] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [teamSelectOpen, setTeamSelectOpen] = useState(false);

  // Handle payment success/cancelled from URL params
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your club subscription is now active.",
      });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your subscription was not activated.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast, queryClient, clubId]);

  // Check if user is a club admin
  const { data: isClubAdmin, isLoading: loadingAdminCheck } = useQuery({
    queryKey: ["is-club-admin", user?.id, clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id")
        .eq("user_id", user!.id);
      
      if (!data) return false;
      
      // App admin can access all
      if (data.some(r => r.role === "app_admin")) return true;
      
      // Club admin for this club
      if (data.some(r => r.role === "club_admin" && r.club_id === clubId)) return true;
      
      return false;
    },
    enabled: !!user && !!clubId,
  });

  const { data: club, isLoading: clubLoading } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: teamCount = 0 } = useQuery({
    queryKey: ["club-team-count", clubId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("club_id", clubId!);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!clubId,
  });

  // Fetch teams for team-specific upgrade option
  const { data: teams = [] } = useQuery({
    queryKey: ["club-teams", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, logo_url, level_age")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!clubId,
  });

  const { data: subscription } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  const isProActive = subscription?.is_pro;
  const isProFootballActive = subscription?.is_pro_football;
  const showFootballOption = isSoccerClub(club?.sport);
  const expiresAt = subscription?.expires_at ? parseISO(subscription.expires_at) : null;
  const isExpired = expiresAt ? isPast(expiresAt) : false;
  const currentPlan = subscription?.plan as PlanTier | undefined;
  const currentTeamLimit = subscription?.team_limit;

  // Trial state
  const isTrial = subscription?.is_trial || false;
  const trialEndsAt = subscription?.trial_ends_at ? parseISO(subscription.trial_ends_at) : null;
  const trialDaysLeft = trialEndsAt ? differenceInDays(trialEndsAt, new Date()) : 0;
  const isTrialExpired = trialEndsAt ? isPast(trialEndsAt) : false;

  // Determine recommended plan based on team count
  const getRecommendedPlan = (count: number): PlanTier => {
    if (count <= 10) return "starter";
    if (count <= 20) return "standard";
    return "unlimited";
  };

  const recommendedPlan = getRecommendedPlan(teamCount);

  // Check if team count exceeds limit (only relevant if there's an active subscription)
  const isOverLimit = isProActive && currentTeamLimit !== null && teamCount > (currentTeamLimit || 0);

  const applyPromoMutation = useMutation({
    mutationFn: async ({ 
      code, 
      tier, 
      plan, 
      isAnnual 
    }: { 
      code: string; 
      tier: "pro" | "pro_football"; 
      plan: PlanTier;
      isAnnual: boolean;
    }) => {
      // Validate promo code
      const { data: promoData, error: promoError } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", code.toUpperCase().trim())
        .eq("is_active", true)
        .maybeSingle();

      if (promoError || !promoData) {
        throw new Error("Invalid or inactive promo code");
      }

      // Check if expired
      if (promoData.expires_at && isPast(parseISO(promoData.expires_at))) {
        throw new Error("This promo code has expired");
      }

      // Validate scope_type matches - must be a club code for club subscription
      if (promoData.scope_type !== 'club') {
        throw new Error("This promo code is for team subscriptions only. Please use a club promo code.");
      }

      // Validate club restriction - if promo code is restricted to a specific club
      if (promoData.club_id && promoData.club_id !== clubId) {
        throw new Error("This promo code is restricted to a different club.");
      }

      // Validate access_level matches selected tier
      if (tier === 'pro_football' && promoData.access_level === 'pro') {
        throw new Error("This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.");
      }
      if (tier === 'pro' && promoData.access_level === 'pro_football') {
        throw new Error("This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.");
      }

      // Calculate team limit based on plan
      const pricing = tier === "pro" ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;
      const teamLimit = pricing[plan].teamLimit;

      // Validate team count doesn't exceed limit
      if (teamLimit !== null && teamCount > teamLimit) {
        throw new Error(`Your club has ${teamCount} teams but the ${plan} plan only supports ${teamLimit}. Please choose a higher plan.`);
      }

      // Use promo code expiry date if set, otherwise default to 1 month/year
      const now = new Date();
      const defaultExpiry = isAnnual ? addYears(now, 1) : addMonths(now, 1);
      const newExpiresAt = promoData.expires_at ? parseISO(promoData.expires_at) : defaultExpiry;

      // Create or update subscription based on tier
      const updateData = tier === "pro" 
        ? { is_pro: true, is_pro_football: false } 
        : { is_pro: true, is_pro_football: true };

      const { error: subError } = await supabase
        .from("club_subscriptions")
        .upsert({
          club_id: clubId!,
          plan: plan,
          team_limit: teamLimit,
          ...updateData,
          promo_code_id: promoData.id,
          activated_at: new Date().toISOString(),
          expires_at: newExpiresAt.toISOString(),
        }, { onConflict: "club_id" });

      if (subError) throw subError;

      // Also update clubs.is_pro for backward compatibility
      await supabase
        .from("clubs")
        .update({ is_pro: true })
        .eq("id", clubId!);

      // Increment promo code usage
      await supabase
        .from("promo_codes")
        .update({ uses_count: promoData.uses_count + 1 })
        .eq("id", promoData.id);

      return { tier, plan };
    },
    onSuccess: ({ tier, plan }) => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      const tierName = tier === "pro" ? "Pro" : "Pro Football";
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      toast({ title: `Club ${tierName} ${planName} Activated!`, description: `All teams now have ${tierName} features.` });
      setPromoCode("");
      setPromoCodeFootball("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (targetTier: "free" | "pro") => {
      if (targetTier === "free") {
        // Remove club subscription entirely
        await supabase
          .from("club_subscriptions")
          .delete()
          .eq("club_id", clubId!);

        // Also update clubs.is_pro for backward compatibility
        await supabase
          .from("clubs")
          .update({ is_pro: false })
          .eq("id", clubId!);
      } else if (targetTier === "pro") {
        // Downgrade from Pro Football to Pro
        const { error } = await supabase
          .from("club_subscriptions")
          .update({ is_pro_football: false })
          .eq("club_id", clubId!);
        if (error) throw error;
      }
      return targetTier;
    },
    onSuccess: (targetTier) => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      const message = targetTier === "free" 
        ? "Club subscription cancelled. All teams are now on Free plan."
        : "Downgraded to Club Pro plan.";
      toast({ title: "Plan Updated", description: message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const handleApplyPromo = async (tier: "pro" | "pro_football") => {
    const code = tier === "pro" ? promoCode : promoCodeFootball;
    const plan = tier === "pro" ? selectedPlan : selectedPlanFootball;
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    if (!code.trim()) return;
    setIsValidating(true);
    try {
      await applyPromoMutation.mutateAsync({ code, tier, plan, isAnnual });
    } catch {
      // Clear the promo code on failure
      if (tier === "pro") {
        setPromoCode("");
      } else {
        setPromoCodeFootball("");
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleStripeCheckout = async (tier: "pro" | "pro_football", withTrial: boolean = false) => {
    const plan = tier === "pro" ? selectedPlan : selectedPlanFootball;
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    setIsCheckingOut(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
        body: {
          subscriptionType: 'club',
          entityId: clubId,
          tier: tier,
          plan: plan,
          isAnnual: isAnnual,
          withTrial: withTrial,
          successUrl: `${window.location.origin}/clubs/${clubId}/upgrade?payment=success`,
          cancelUrl: `${window.location.origin}/clubs/${clubId}/upgrade?payment=cancelled`,
        },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: "Checkout Error",
        description: "Failed to start checkout. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Check if Stripe is configured
  const { data: hasStripeConfig } = useQuery({
    queryKey: ["stripe-config-check", clubId],
    queryFn: async () => {
      // Check club config
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("id, is_enabled")
        .eq("club_id", clubId!)
        .eq("is_enabled", true)
        .maybeSingle();
      
      if (clubConfig) return true;

      // Check app config
      const { data: appConfig } = await supabase
        .from("app_stripe_config")
        .select("id, is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();
      
      return !!appConfig;
    },
    enabled: !!clubId,
  });

  if (clubLoading || loadingAdminCheck) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Club not found</p>
      </div>
    );
  }

  if (!isClubAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Club Pro Plans</h1>
        </div>
        <Card className="border-destructive/20 bg-destructive/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto mb-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Admin Access Required</h3>
            <p className="text-muted-foreground text-sm">
              Only club administrators can purchase club subscriptions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderExpiryBanner = () => {
    if (!expiresAt) return null;
    
    if (isExpired) {
      return (
        <Card className="border-destructive/50 bg-destructive/10 mb-4">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Subscription Expired</p>
              <p className="text-sm text-muted-foreground">
                Your subscription expired on {format(expiresAt, "dd MMM yyyy")}. 
                Renew now to continue accessing Pro features.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-primary/30 bg-primary/5 mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="text-sm">
              <span className="font-medium">Paid until:</span>{" "}
              <span className="text-primary font-semibold">{format(expiresAt, "dd MMMM yyyy")}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTrialBanner = () => {
    if (!isTrial || !trialEndsAt) return null;
    
    if (isTrialExpired) {
      return (
        <Card className="border-destructive/50 bg-destructive/10 mb-4">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-destructive">Trial Expired</p>
              <p className="text-sm text-muted-foreground">
                Your trial ended on {format(trialEndsAt, "dd MMM yyyy")}. 
                Subscribe now to continue accessing Pro features.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-blue-500/50 bg-blue-500/10 mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <Clock className="h-5 w-5 text-blue-500 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-blue-600">
              Trial Active - {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left
            </p>
            <p className="text-sm text-muted-foreground">
              Ends on {format(trialEndsAt, "dd MMMM yyyy")}. Your subscription will start automatically.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTeamCountBanner = () => {
    if (isOverLimit) {
      return (
        <Card className="border-destructive/50 bg-destructive/10 mb-4">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Team Limit Exceeded</p>
              <p className="text-sm text-muted-foreground">
                Your club has {teamCount} teams but your current plan only allows {currentTeamLimit}. 
                Please upgrade to continue using Pro features for all teams.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  const renderPlanSelector = (
    plan: PlanTier,
    setPlan: (p: PlanTier) => void,
    tier: "pro" | "proFootball"
  ) => {
    const pricing = tier === "pro" ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;

    return (
      <div className="space-y-3 mb-4">
        <Label className="text-sm font-medium">Select Plan</Label>
        <div className="grid gap-2">
          {(["starter", "standard", "unlimited"] as PlanTier[]).map((p) => {
            const planPricing = pricing[p];
            const isRecommended = p === recommendedPlan;
            const isDisabled = planPricing.teamLimit !== null && teamCount > planPricing.teamLimit;

            return (
              <button
                key={p}
                onClick={() => !isDisabled && setPlan(p)}
                disabled={isDisabled}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  plan === p
                    ? "border-primary bg-primary/10"
                    : isDisabled
                    ? "border-muted bg-muted/50 opacity-50 cursor-not-allowed"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{p}</span>
                    {isRecommended && !isDisabled && (
                      <Badge variant="secondary" className="text-xs">Recommended</Badge>
                    )}
                    {isDisabled && (
                      <Badge variant="outline" className="text-xs text-destructive border-destructive">
                        {teamCount} teams exceeds limit
                      </Badge>
                    )}
                  </div>
                  <span className="font-bold">${planPricing.monthly}/mo</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {planPricing.teamLimit ? `Up to ${planPricing.teamLimit} teams` : "Unlimited teams"}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPricingToggle = (isAnnual: boolean, setIsAnnual: (val: boolean) => void) => {
    return (
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-center gap-3">
          <span className={`text-sm ${!isAnnual ? "font-semibold" : "text-muted-foreground"}`}>
            Monthly
          </span>
          <Switch
            checked={isAnnual}
            onCheckedChange={setIsAnnual}
          />
          <span className={`text-sm ${isAnnual ? "font-semibold" : "text-muted-foreground"}`}>
            Annual
          </span>
          {isAnnual && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
              Save 20%
            </Badge>
          )}
        </div>
      </div>
    );
  };

  const renderProActiveCard = (tier: "pro" | "pro_football") => {
    const isPro = tier === "pro";
    const Icon = isPro ? Crown : Target;
    const title = isPro ? "Club Pro Active" : "Club Pro Football Active";
    const description = isPro 
      ? "All teams have full access to Pro features."
      : "All teams have access to Pro Football features including Pitch Board.";

    return (
      <Card className={isPro ? "border-yellow-500/50 bg-yellow-500/10" : "border-emerald-500/50 bg-emerald-500/10"}>
        <CardContent className="p-6 text-center space-y-4">
          <Icon className={`h-12 w-12 ${isPro ? "text-yellow-500" : "text-emerald-500"} mx-auto`} />
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>

          {currentPlan && (
            <Badge variant="outline" className="text-base px-4 py-1">
              {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
              {currentTeamLimit ? ` (${teamCount}/${currentTeamLimit} teams)` : " (Unlimited teams)"}
            </Badge>
          )}
          
          {expiresAt && (
            <div className={`p-3 rounded-lg ${isExpired ? 'bg-destructive/10' : 'bg-muted/50'} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-2">
                <Calendar className={`h-4 w-4 ${isExpired ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span className={`text-sm ${isExpired ? 'text-destructive font-semibold' : ''}`}>
                  {isExpired ? 'Payment failed on ' : 'Auto-renews on '}
                  <strong>{format(expiresAt, "dd MMMM yyyy")}</strong>
                </span>
              </div>
              {!isExpired && (
                <p className="text-xs text-muted-foreground">
                  You'll receive a reminder 7 days before renewal
                </p>
              )}
            </div>
          )}

          {isExpired && (
            <p className="text-sm text-destructive text-center">
              Your payment failed. Please update your payment method to continue accessing Pro features.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {tier === "pro_football" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-muted-foreground">
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Downgrade to Club Pro
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Downgrade to Club Pro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove Pitch Board access from all teams but keep all other Pro features.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => downgradeMutation.mutate("pro")}
                      disabled={downgradeMutation.isPending}
                    >
                      {downgradeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Downgrade to Pro
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">
                  <ArrowDown className="h-4 w-4 mr-2" />
                  Cancel Club Subscription
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Club Subscription?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all Pro features from all teams in your club. Individual teams can still upgrade separately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => downgradeMutation.mutate("free")}
                    disabled={downgradeMutation.isPending}
                  >
                    {downgradeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Confirm Cancellation
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPricingCard = (tier: "pro" | "pro_football") => {
    const isPro = tier === "pro";
    const pricing = isPro ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;
    const features = isPro ? PRO_FEATURES : PRO_FOOTBALL_FEATURES;
    const plan = isPro ? selectedPlan : selectedPlanFootball;
    const setPlan = isPro ? setSelectedPlan : setSelectedPlanFootball;
    const isAnnual = isPro ? isAnnualPro : isAnnualProFootball;
    const setIsAnnual = isPro ? setIsAnnualPro : setIsAnnualProFootball;
    const code = isPro ? promoCode : promoCodeFootball;
    const setCode = isPro ? setPromoCode : setPromoCodeFootball;
    const badgeClass = isPro ? "bg-yellow-500 text-yellow-950" : "bg-emerald-500 text-emerald-950";
    const checkClass = isPro ? "bg-primary/20 text-primary" : "bg-emerald-500/20 text-emerald-500";

    const monthlyPrice = pricing[plan].monthly;
    const annualPrice = Math.round(monthlyPrice * 12 * 0.8);
    const annualSavings = Math.round(monthlyPrice * 12 - annualPrice);

    return (
      <>
        <Card className={isPro ? "border-primary/30" : "border-emerald-500/30"}>
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <Badge className={badgeClass}>
                CLUB {isPro ? "PRO" : "PRO FOOTBALL"}
              </Badge>
            </div>
            
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
              <Users className="h-4 w-4" />
              <span>Your club: {teamCount} teams</span>
            </div>

            {renderPlanSelector(plan, setPlan, isPro ? "pro" : "proFootball")}
            {renderPricingToggle(isAnnual, setIsAnnual)}
            
            <CardTitle className="text-3xl">
              ${isAnnual ? annualPrice : monthlyPrice}{" "}
              <span className="text-lg font-normal text-muted-foreground">
                AUD/{isAnnual ? "year" : "month"}
              </span>
            </CardTitle>
            {isAnnual && (
              <p className="text-sm text-green-600 font-medium">
                Save ${annualSavings} per year
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              All teams get Pro{!isPro && " Football"} access
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-3">
                  <div className={`h-5 w-5 rounded-full ${checkClass.split(" ")[0]} flex items-center justify-center shrink-0`}>
                    <Check className={`h-3 w-3 ${checkClass.split(" ")[1]}`} />
                  </div>
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Button 
                className={`w-full ${!isPro ? "bg-emerald-600 hover:bg-emerald-700" : ""}`} 
                size="lg" 
                onClick={() => {
                  if (!hasStripeConfig) {
                    toast({
                      title: "Payment Not Configured",
                      description: "Contact your club administrator to set up payment processing.",
                      variant: "destructive",
                    });
                    return;
                  }
                  handleStripeCheckout(tier, true);
                }}
                disabled={isCheckingOut}
              >
                {isCheckingOut ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Start 14-Day Free Trial
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Payment details required • Then ${isAnnual ? annualPrice : monthlyPrice}/{isAnnual ? 'year' : 'month'} • Cancel anytime
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Ticket className="h-5 w-5" />
              Have a Promo Code?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`promo-club-${tier}`}>Enter promo code</Label>
              <div className="flex gap-2">
                <Input
                  id={`promo-club-${tier}`}
                  placeholder={isPro ? "CLUBPRO2024" : "CLUBFOOTBALL2024"}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="uppercase"
                />
                <Button 
                  onClick={() => handleApplyPromo(tier)} 
                  disabled={!code.trim() || isValidating || applyPromoMutation.isPending}
                >
                  {(isValidating || applyPromoMutation.isPending) && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  Apply
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    );
  };

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Club Pro Plans</h1>
          <p className="text-sm text-muted-foreground">{club.name}</p>
        </div>
        <Building2 className="h-8 w-8 text-primary" />
      </div>

      {/* Team Limit Warning */}
      {renderTeamCountBanner()}

      {/* Trial Banner */}
      {isTrial && renderTrialBanner()}

      {/* Expiry Banner for active subscriptions (non-trial) */}
      {(isProActive || isProFootballActive) && !isTrial && renderExpiryBanner()}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Club Pro</strong> gives all teams in your club Pro access with one subscription. 
            Great value for clubs with multiple teams!
          </p>
        </CardContent>
      </Card>

      {/* Team-Specific Plan Option */}
      {teams && teams.length > 0 && (
        <Card className="border-muted">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isProActive || isProFootballActive 
                    ? "Manage individual team subscriptions" 
                    : "Prefer to upgrade a single team?"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isProActive || isProFootballActive 
                    ? "View or manage team-specific Pro plans" 
                    : "Choose a team-specific Pro plan instead"}
                </p>
              </div>
              <Dialog open={teamSelectOpen} onOpenChange={setTeamSelectOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Users className="h-4 w-4 mr-2" />
                    {isProActive || isProFootballActive ? "View Teams" : "Choose Team"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Select Team</DialogTitle>
                    <DialogDescription>
                      {isProActive || isProFootballActive 
                        ? "Select a team to view its Pro subscription" 
                        : "Choose which team you'd like to upgrade to Pro"}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {teams.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setTeamSelectOpen(false);
                          navigate(`/teams/${t.id}/upgrade`);
                        }}
                        className="w-full p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 text-left transition-colors flex items-center gap-3"
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={t.logo_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary">
                            {t.name?.charAt(0)?.toUpperCase() || "T"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{t.name}</p>
                          {t.level_age && (
                            <p className="text-xs text-muted-foreground">{t.level_age}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {showFootballOption ? (
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pro" disabled={isProActive && !isProFootballActive && !isExpired}>
              Club Pro {isProActive && !isProFootballActive && !isExpired && "✓"}
            </TabsTrigger>
            <TabsTrigger value="pro_football" disabled={isProFootballActive && !isExpired}>
              Club Pro Football {isProFootballActive && !isExpired && "✓"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pro" className="mt-4 space-y-4">
            {isProActive && !isProFootballActive && !isExpired ? (
              renderProActiveCard("pro")
            ) : (
              renderPricingCard("pro")
            )}
          </TabsContent>

          <TabsContent value="pro_football" className="mt-4 space-y-4">
            {isProFootballActive && !isExpired ? (
              renderProActiveCard("pro_football")
            ) : (
              renderPricingCard("pro_football")
            )}
          </TabsContent>
        </Tabs>
      ) : (
        // Non-football clubs only see Pro option
        <>
          {isProActive && !isExpired ? (
            renderProActiveCard("pro")
          ) : (
            renderPricingCard("pro")
          )}
        </>
      )}
    </div>
  );
}
