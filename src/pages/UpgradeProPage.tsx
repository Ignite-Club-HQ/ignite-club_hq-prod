import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Crown, Loader2, Ticket, Target, ArrowDown, Calendar, AlertCircle, Building2, CreditCard, Clock } from "lucide-react";
import { isPast, parseISO, format, addMonths, addYears, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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
  "Team Chat & Messaging",
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
];

// Pricing in AUD
const PRICING = {
  pro: {
    monthly: 25,
    annual: 240, // 20% off ($25 * 12 * 0.8)
  },
  proFootball: {
    monthly: 40,
    annual: 384, // 20% off ($40 * 12 * 0.8)
  },
};

// Check if club sport is soccer/football
const isSoccerClub = (sport: string | null | undefined): boolean => {
  if (!sport) return false;
  const lowerSport = sport.toLowerCase();
  return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
};

export default function UpgradeProPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [promoCode, setPromoCode] = useState("");
  const [promoCodeFootball, setPromoCodeFootball] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [selectedTab, setSelectedTab] = useState("pro");
  const [isAnnualPro, setIsAnnualPro] = useState(false);
  const [isAnnualProFootball, setIsAnnualProFootball] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Handle payment success/cancelled from URL params
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your subscription is now active.",
      });
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your subscription was not activated.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast, queryClient, teamId]);

  // Check if user is a team admin or club admin for the team's club
  const { data: adminStatus, isLoading: loadingAdminCheck } = useQuery({
    queryKey: ["is-team-admin", user?.id, teamId],
    queryFn: async () => {
      // First get user roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user!.id);
      
      if (!roles) return { isTeamAdmin: false, isClubAdmin: false };
      
      // Check if user is club admin for the team's club
      const { data: team } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", teamId!)
        .single();
      
      const isClubAdmin = team && roles.some(r => r.role === "club_admin" && r.club_id === team.club_id);
      const isAppAdmin = roles.some(r => r.role === "app_admin");
      
      // App admin can access all
      if (isAppAdmin) return { isTeamAdmin: true, isClubAdmin: true };
      
      // Team admin for this team
      if (roles.some(r => r.role === "team_admin" && r.team_id === teamId)) {
        return { isTeamAdmin: true, isClubAdmin: !!isClubAdmin };
      }
      
      // Club admin for the team's club can also upgrade team plans
      if (isClubAdmin) {
        return { isTeamAdmin: true, isClubAdmin: true };
      }
      
      return { isTeamAdmin: false, isClubAdmin: false };
    },
    enabled: !!user && !!teamId,
  });

  const isTeamAdmin = adminStatus?.isTeamAdmin ?? false;
  const isClubAdminForTeam = adminStatus?.isClubAdmin ?? false;

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs (id, name, is_pro, sport)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: subscription } = useQuery({
    queryKey: ["team-subscription", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", teamId!)
        .maybeSingle();
      return data;
    },
    enabled: !!teamId,
  });

  // Check for club-level subscription
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription-for-team", team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!team?.club_id,
  });

  // Team has pro access via team subscription OR club subscription
  const hasClubProAccess = clubSubscription?.is_pro && (!clubSubscription.expires_at || !isPast(parseISO(clubSubscription.expires_at)));
  const hasClubProFootballAccess = clubSubscription?.is_pro_football && (!clubSubscription.expires_at || !isPast(parseISO(clubSubscription.expires_at)));
  
  const isProActive = subscription?.is_pro || team?.clubs?.is_pro || hasClubProAccess;
  const isProFootballActive = subscription?.is_pro_football || hasClubProFootballAccess;
  const showFootballOption = isSoccerClub(team?.clubs?.sport);
  const expiresAt = subscription?.expires_at ? parseISO(subscription.expires_at) : null;
  const isExpired = expiresAt ? isPast(expiresAt) : false;
  
  // Trial state
  const isTrial = subscription?.is_trial || false;
  const trialEndsAt = subscription?.trial_ends_at ? parseISO(subscription.trial_ends_at) : null;
  const trialDaysLeft = trialEndsAt ? differenceInDays(trialEndsAt, new Date()) : 0;
  const isTrialExpired = trialEndsAt ? isPast(trialEndsAt) : false;

  const applyPromoMutation = useMutation({
    mutationFn: async ({ code, tier, isAnnual }: { code: string; tier: "pro" | "pro_football"; isAnnual: boolean }) => {
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

      // Validate scope_type matches - must be a team code for team subscription
      if (promoData.scope_type !== 'team') {
        throw new Error("This promo code is for club subscriptions only. Please use a team promo code.");
      }

      // Validate club restriction - if promo code is restricted to a specific club
      if (promoData.club_id && promoData.club_id !== team?.club_id) {
        throw new Error("This promo code is restricted to a different club.");
      }

      // Validate access_level matches selected tier
      if (tier === 'pro_football' && promoData.access_level === 'pro') {
        throw new Error("This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.");
      }
      if (tier === 'pro' && promoData.access_level === 'pro_football') {
        throw new Error("This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.");
      }

      // Use promo code expiry date if set, otherwise default to 1 month/year
      const now = new Date();
      const defaultExpiry = isAnnual ? addYears(now, 1) : addMonths(now, 1);
      const newExpiresAt = promoData.expires_at ? parseISO(promoData.expires_at) : defaultExpiry;

      // Create or update subscription based on tier
      // Pro Football includes all Pro features, so we set both flags
      const updateData = tier === "pro" 
        ? { is_pro: true } 
        : { is_pro: true, is_pro_football: true };

      const { error: subError } = await supabase
        .from("team_subscriptions")
        .upsert({
          team_id: teamId!,
          ...updateData,
          promo_code_id: promoData.id,
          activated_at: new Date().toISOString(),
          expires_at: newExpiresAt.toISOString(),
        }, { onConflict: "team_id" });

      if (subError) throw subError;

      // Increment promo code usage
      await supabase
        .from("promo_codes")
        .update({ uses_count: promoData.uses_count + 1 })
        .eq("id", promoData.id);

      return tier;
    },
    onSuccess: (tier) => {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      const tierName = tier === "pro" ? "Pro" : "Pro Football";
      toast({ title: `${tierName} Activated!`, description: `Your team now has ${tierName} features.` });
      setPromoCode("");
      setPromoCodeFootball("");
    },
    onError: (error: Error) => {
      toast({ title: "Invalid Code", description: error.message, variant: "destructive" });
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (targetTier: "free" | "pro") => {
      if (targetTier === "free") {
        // Downgrade to free - remove all pro features and trial
        const { error } = await supabase
          .from("team_subscriptions")
          .update({ 
            is_pro: false, 
            is_pro_football: false, 
            expires_at: null,
            is_trial: false,
            trial_ends_at: null,
            trial_tier: null,
            trial_plan: null,
            trial_is_annual: null
          })
          .eq("team_id", teamId!);
        if (error) throw error;
      } else if (targetTier === "pro") {
        // Downgrade from Pro Football to Pro
        const { error } = await supabase
          .from("team_subscriptions")
          .update({ is_pro_football: false })
          .eq("team_id", teamId!);
        if (error) throw error;
      }
      return targetTier;
    },
    onSuccess: (targetTier) => {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      const message = targetTier === "free" 
        ? "Subscription cancelled. Team is now on Free plan."
        : "Downgraded to Pro plan.";
      toast({ title: "Plan Updated", description: message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const handleApplyPromo = async (tier: "pro" | "pro_football") => {
    const code = tier === "pro" ? promoCode : promoCodeFootball;
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    if (!code.trim()) return;
    setIsValidating(true);
    try {
      await applyPromoMutation.mutateAsync({ code, tier, isAnnual });
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
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    setIsCheckingOut(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
        body: {
          subscriptionType: 'team',
          entityId: teamId,
          tier: tier,
          isAnnual: isAnnual,
          withTrial: withTrial,
          successUrl: `${window.location.origin}/teams/${teamId}/upgrade?payment=success`,
          cancelUrl: `${window.location.origin}/teams/${teamId}/upgrade?payment=cancelled`,
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
    queryKey: ["stripe-config-check", team?.club_id],
    queryFn: async () => {
      // Check club config
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("id, is_enabled")
        .eq("club_id", team!.club_id)
        .eq("is_enabled", true)
        .maybeSingle();
      
      if (clubConfig) return true;

      // Check app config (only admins can see this, so we check if response is valid)
      const { data: appConfig, error } = await supabase
        .from("app_stripe_config")
        .select("id, is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();
      
      // If no error and data exists, config exists
      return !!appConfig;
    },
    enabled: !!team?.club_id,
  });

  if (teamLoading || loadingAdminCheck) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  if (!isTeamAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Upgrade to Pro</h1>
        </div>
        <Card className="border-destructive/20 bg-destructive/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto mb-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Admin Access Required</h3>
            <p className="text-muted-foreground text-sm">
              Only team administrators can purchase team subscriptions.
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

  const renderPricingToggle = (isAnnual: boolean, setIsAnnual: (val: boolean) => void, tier: "pro" | "proFootball") => {
    const pricing = tier === "pro" ? PRICING.pro : PRICING.proFootball;
    const annualSavings = tier === "pro" ? 60 : 96;

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
    const colorClass = isPro ? "yellow" : "emerald";
    const title = isPro ? "Pro Active" : "Pro Football Active";
    const description = isPro 
      ? "This team has full access to all Pro features."
      : "This team has access to the Soccer Pitch Board.";

    return (
      <Card className={`border-${colorClass}-500/50 bg-${colorClass}-500/10`}>
        <CardContent className="p-6 text-center space-y-4">
          <Icon className={`h-12 w-12 text-${colorClass}-500 mx-auto`} />
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>
          
          {expiresAt && (
            <div className={`p-3 rounded-lg ${isExpired ? 'bg-destructive/10' : 'bg-muted/50'} flex items-center justify-center gap-2`}>
              <Calendar className={`h-4 w-4 ${isExpired ? 'text-destructive' : 'text-muted-foreground'}`} />
              <span className={`text-sm ${isExpired ? 'text-destructive font-semibold' : ''}`}>
                {isExpired ? 'Expired on ' : 'Paid until '}
                <strong>{format(expiresAt, "dd MMMM yyyy")}</strong>
              </span>
            </div>
          )}

          {isExpired && (
            <p className="text-sm text-destructive">
              Your subscription has expired. Features will be disabled until you renew.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {tier === "pro_football" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-muted-foreground">
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Downgrade to Pro ($25/mo)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Downgrade to Pro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the Soccer Pitch Board feature but keep all other Pro features. You can upgrade back to Pro Football anytime.
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
                  Downgrade to Free
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Downgrade to Free Plan?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all Pro features from your team including Ignite Points, club announcements, media uploads, and vault storage. This action can be reversed by upgrading again.
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
                    Confirm Downgrade
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
    const pricing = isPro ? PRICING.pro : PRICING.proFootball;
    const features = isPro ? PRO_FEATURES : PRO_FOOTBALL_FEATURES;
    const isAnnual = isPro ? isAnnualPro : isAnnualProFootball;
    const setIsAnnual = isPro ? setIsAnnualPro : setIsAnnualProFootball;
    const code = isPro ? promoCode : promoCodeFootball;
    const setCode = isPro ? setPromoCode : setPromoCodeFootball;
    const colorClass = isPro ? "primary" : "emerald";
    const badgeClass = isPro ? "bg-yellow-500 text-yellow-950" : "bg-emerald-500 text-emerald-950";
    const checkClass = isPro ? "bg-primary/20 text-primary" : "bg-emerald-500/20 text-emerald-500";
    const annualSavings = isPro ? 60 : 96;

    return (
      <>
        <Card className={isPro ? "border-primary/30" : "border-emerald-500/30"}>
          <CardHeader className="text-center pb-2">
            <Badge className={`w-fit mx-auto mb-2 ${badgeClass}`}>
              {isPro ? "PRO" : "PRO FOOTBALL"}
            </Badge>
            
            {renderPricingToggle(isAnnual, setIsAnnual, isPro ? "pro" : "proFootball")}
            
            <CardTitle className="text-3xl">
              ${isAnnual ? pricing.annual : pricing.monthly}{" "}
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
              per team{!isPro && " • includes all Pro features"}
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
                Payment details required • Then {isAnnual ? `$${isPro ? 240 : 384}/year` : `$${isPro ? 25 : 40}/month`} • Cancel anytime
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
              <Label htmlFor={`promo-${tier}`}>Enter promo code</Label>
              <div className="flex gap-2">
                <Input
                  id={`promo-${tier}`}
                  placeholder={isPro ? "PROMO2024" : "FOOTBALL2024"}
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
          <h1 className="text-2xl font-bold">Upgrade to Pro</h1>
          <p className="text-sm text-muted-foreground">{team.name}</p>
        </div>
        <Crown className="h-8 w-8 text-yellow-500" />
      </div>

      {/* Club Pro Banner */}
      {(hasClubProAccess || hasClubProFootballAccess) && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">
                This team has {hasClubProFootballAccess ? "Pro Football" : "Pro"} access via Club subscription
              </p>
              <p className="text-xs text-muted-foreground">
                Manage your club subscription to change plans
              </p>
            </div>
            <Link to={`/clubs/${team.club_id}/upgrade`}>
              <Button variant="outline" size="sm">
                Club Plans
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Trial Banner */}
      {isTrial && !hasClubProAccess && !hasClubProFootballAccess && renderTrialBanner()}

      {/* Expiry Banner for active subscriptions (non-trial) */}
      {(isProActive || isProFootballActive) && !isTrial && !hasClubProAccess && !hasClubProFootballAccess && renderExpiryBanner()}

      {showFootballOption ? (
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pro" disabled={(isProActive && !isExpired) || hasClubProAccess}>
              Pro {(isProActive && !isExpired) && "✓"}
            </TabsTrigger>
            <TabsTrigger value="pro_football" disabled={(isProFootballActive && !isExpired) || hasClubProFootballAccess}>
              Pro Football {(isProFootballActive && !isExpired) && "✓"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pro" className="mt-4 space-y-4">
            {hasClubProAccess ? (
              <Card className="border-muted bg-muted/30">
                <CardContent className="p-6 text-center space-y-3">
                  <Crown className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h2 className="text-xl font-bold text-muted-foreground">Pro Included via Club</h2>
                    <p className="text-muted-foreground mt-2">
                      This team already has Pro access through the club subscription.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : isProActive && !isProFootballActive && !isExpired ? (
              renderProActiveCard("pro")
            ) : (
              renderPricingCard("pro")
            )}
          </TabsContent>

          <TabsContent value="pro_football" className="mt-4 space-y-4">
            {hasClubProFootballAccess ? (
              <Card className="border-muted bg-muted/30">
                <CardContent className="p-6 text-center space-y-3">
                  <Target className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h2 className="text-xl font-bold text-muted-foreground">Pro Football Included via Club</h2>
                    <p className="text-muted-foreground mt-2">
                      This team already has Pro Football access through the club subscription.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : isProFootballActive && !isExpired ? (
              renderProActiveCard("pro_football")
            ) : (
              renderPricingCard("pro_football")
            )}
          </TabsContent>
        </Tabs>
      ) : (
        // Non-football clubs only see Pro option
        <>
          {hasClubProAccess ? (
            <Card className="border-muted bg-muted/30">
              <CardContent className="p-6 text-center space-y-3">
                <Crown className="h-12 w-12 text-muted-foreground mx-auto" />
                <div>
                  <h2 className="text-xl font-bold text-muted-foreground">Pro Included via Club</h2>
                  <p className="text-muted-foreground mt-2">
                    This team already has Pro access through the club subscription.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : isProActive && !isExpired ? (
            renderProActiveCard("pro")
          ) : (
            renderPricingCard("pro")
          )}
        </>
      )}

      {/* Club Plans Option - only show to club admins */}
      {!hasClubProAccess && !hasClubProFootballAccess && isClubAdminForTeam && (
        <Card className="border-muted mt-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Prefer a club-wide plan?</p>
                <p className="text-xs text-muted-foreground">Upgrade all teams at once with a club subscription</p>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate(`/clubs/${team.club_id}/upgrade`)}
              >
                <Building2 className="h-4 w-4 mr-2" />
                Club Plans
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Club Plans message for team admins who aren't club admins */}
      {!hasClubProAccess && !hasClubProFootballAccess && !isClubAdminForTeam && (
        <Card className="border-muted mt-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Prefer a club-wide plan?</p>
                <p className="text-xs text-muted-foreground">Contact your club admin for a club subscription</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
