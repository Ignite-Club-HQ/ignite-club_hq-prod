import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { acceptLegacyClubInvite } from "@/lib/legacyClubInvite";
import { useToast } from "@/hooks/use-toast";
import { AppStoreDownloadGuide } from "@/components/AppStoreDownloadGuide";
import { setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import type { Database } from "@/integrations/supabase/types";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabProfile } from "@/lab/fixtureDataLayer";
import { resolveAuthBackend, setAuthMethodChoice } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { acceptLiveMembershipPendingInvite } from "@/live/features/membership";
import { getLiveClubProfile, getLivePendingInvite } from "@/live/features/club";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
  association_admin: "Association Admin",
  competition_admin: "Competition Admin",
};

export default function JoinClubPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  const onChainInvite = token?.startsWith("pinv-") === true;
  const isIcp = resolveAuthBackend() === "icp" || onChainInvite;
  const wrongProvider = onChainInvite ? user?.app_metadata?.provider !== "icp" : isIcp;
  const [switching, setSwitching] = useState(false);
  const [joined, setJoined] = useState(false);
  const autoJoinAttempted = useRef(false);

  // ICP: the invite token is the club_domain PendingInvite id (anonymous
  // query; the id is the secret) — resolve its club for the pre-accept card.
  const [icpInviteClub, setIcpInviteClub] = useState<{ name: string; logoUrl: string | null } | null>(null);
  useEffect(() => {
    if (!isIcp || wrongProvider || !token || !user) return;
    let cancelled = false;
    void withFeatureBackend("membership", {
      supabase: async () => undefined,
      icp: async (ctx) => {
        const invite = await getLivePendingInvite(ctx, token);
        if (!invite?.club_id || cancelled) return;
        const profile = await getLiveClubProfile(ctx, invite.club_id);
        const name = profile[0]?.name;
        if (name && !cancelled) setIcpInviteClub({ name, logoUrl: profile[0]?.logo_url?.[0] ?? null });
      },
    }, { inviteToken: token }).catch(() => {
      // Preview is best-effort; accepting still works without it.
    });
    return () => {
      cancelled = true;
    };
  }, [isIcp, wrongProvider, token, user]);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = sessionStorage.getItem("autoJoinAfterAuth") === "true";

  // Fetch invite details using secure RPC function
  const { data: invite, isLoading: inviteLoading, error: inviteError } = useQuery({
    queryKey: ["club-invite", token, useIcpLab],
    enabled: !isIcp && !!token,
    queryFn: async () => {
      if (useIcpLab) return null;
      if (!token) return null;
      const { data, error } = await supabase
        .rpc("get_club_invite_by_token", { _token: token });
      if (error) throw error;
      // Transform RPC result to match expected shape
      if (data && data.length > 0) {
        const row = data[0];
        return {
          id: row.id,
          club_id: row.club_id,
          role: row.role,
          token: row.token,
          uses_count: row.uses_count,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          created_at: row.created_at,
          created_by: row.created_by,
          clubs: {
            id: row.club_id,
            name: row.club_name,
            logo_url: row.club_logo_url,
            description: row.club_description
          }
        };
      }
      return null;
    },
  });

  // Fetch user's existing roles in this club
  const { data: existingRoles } = useQuery({
    queryKey: ["user-club-roles", invite?.club_id, user?.id, useIcpLab],
    enabled: !isIcp && !!invite?.club_id && !!user,
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", invite!.club_id);
      return data?.map(r => r.role as AppRole) || [];
    },
  });

  // Fetch user's profile to check if profile is complete
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile-for-join-club", user?.id, useIcpLab],
    enabled: !isIcp && !!user,
    queryFn: async () => {
      if (useIcpLab) return getLocalLabProfile(user!.id);
      const { data } = await selectCachedProfileById(user!.id);
      return data;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Check if user needs to complete their profile first
  const needsProfileCompletion = user && userProfile !== undefined && !userProfile?.display_name;

  // Set up invite flow context when invite is loaded (for progress tracking across pages)
  useEffect(() => {
    if (invite) {
      // Check if we're resuming from a stored context (e.g., after PWA install)
      const existingContext = getInviteFlowContext();
      const resumeStep = existingContext?.currentStep;
      
      setInviteFlowContext({
        active: true,
        clubName: invite.clubs?.name || undefined,
        clubLogoUrl: invite.clubs?.logo_url || undefined,
        teamName: undefined,
        role: invite.role,
        inviteToken: token,
        currentStep: resumeStep || "view",
      });
    }
  }, [invite, token]);

  // Clear invite flow context on successful join
  useEffect(() => {
    if (joined) {
      clearInviteFlowContext();
    }
  }, [joined]);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (wrongProvider) throw new Error("Please switch sign-in methods before accepting this invitation.");
      if (isIcp) {
        // II users: the share token is the club_domain PendingInvite id —
        // accept it directly (there is no separate "preview before
        // accepting" query on the canister yet, see membership.ts).
        if (!token || !user) throw new Error("Missing data");
        return withFeatureBackend("membership", {
          supabase: async () => {
            throw new Error("Unexpected backend routing for an ICP join");
          },
          icp: async (ctx) => {
            const accepted = await acceptLiveMembershipPendingInvite(ctx, token);
            const roleToAdd = (accepted.role?.[0] ?? "basic_user") as AppRole;
            let clubName: string | undefined;
            let clubLogoUrl: string | undefined;
            try {
              const profile = await getLiveClubProfile(ctx, accepted.club_id);
              clubName = profile[0]?.name;
              clubLogoUrl = profile[0]?.logo_url?.[0] ?? undefined;
              if (clubName) setIcpInviteClub({ name: clubName, logoUrl: clubLogoUrl ?? null });
            } catch {
              // Club profile lookup is best-effort for the success toast only.
            }
            setInviteFlowContext({
              active: true,
              clubName,
              clubLogoUrl,
              teamName: undefined,
              role: roleToAdd,
              inviteToken: token,
              currentStep: "view",
            });
            return roleToAdd;
          },
        }, { inviteToken: token });
      }
      if (!invite || !user) throw new Error("Missing data");

      // The server validates the token, issuer and limits, then commits both
      // membership and usage under the same lock. Never replay a failed write.
      await acceptLegacyClubInvite(token ?? "", { clubId: invite.club_id, role: invite.role });
      const roleToAdd = invite.role as AppRole;

      return roleToAdd;
    },
    onSuccess: (role) => {
      setJoined(true);
      toast({ title: `Successfully joined as ${roleLabels[role]}!` });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join club", variant: "destructive" });
    },
  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    if (wrongProvider) return;
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      safeSessionSet("redirectAfterAuth", `/join-club/${token}`);
      safeSessionSet("autoJoinAfterAuth", "true"); // Ensure flag is set

      navigate("/complete-profile", { replace: true });
      return;
    }

    // Wait for invite data to load before attempting auto-join
    if (inviteLoading) return;

    if (
      shouldAutoJoin && 
      user && 
      invite && 
      userProfile?.display_name && // Only auto-join if profile is complete
      !joined && 
      !joinMutation.isPending &&
      !autoJoinAttempted.current
    ) {
      autoJoinAttempted.current = true;
      try { sessionStorage.removeItem("autoJoinAfterAuth"); } catch { /* storage blocked */ }
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [wrongProvider, shouldAutoJoin, user, invite, userProfile, joined, joinMutation, token, navigate, profileLoading, inviteLoading]);

  // Handle join action - redirect to auth if not logged in
  const handleJoinClick = async () => {
    // If not logged in, redirect to auth with auto-join flag
    if (!user) {
      // Storage writes MUST be guarded: a throwing sessionStorage (restricted
      // webviews / blocked storage) used to abort this handler before
      // `navigate`, so the button appeared to do nothing.
      const nextPath = `/join-club/${token}`;
      safeSessionSet("redirectAfterAuth", nextPath);
      safeSessionSet("autoJoinAfterAuth", "true");
      console.log("[SignupFlow] JoinClub → /auth", { nextPath });
      navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup", invite: token }));
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      safeSessionSet("redirectAfterAuth", `/join-club/${token}`);
      safeSessionSet("autoJoinAfterAuth", "true");
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join
    joinMutation.mutate();
  };

  if (wrongProvider) return <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-background"><h1 className="text-xl font-semibold">{onChainInvite ? "Internet Identity required" : "Email sign-in required"}</h1><p className="text-muted-foreground">Switch sign-in methods to open this invitation. Your existing memberships remain unchanged.</p><Button disabled={switching} onClick={() => {
    if (switching) return;
    setSwitching(true);
    void (async () => {
      try { if (user) await signOut(); setAuthMethodChoice(onChainInvite ? "icp" : "supabase"); navigate(buildAuthPathWithIntent({ next: `/join-club/${token}`, mode: "signin", invite: token })); }
      catch { setSwitching(false); toast({ title: "Couldn't switch sign-in methods. Please try again.", variant: "destructive" }); }
    })();
  }}>{onChainInvite ? "Continue with Internet Identity" : "Continue with email"}</Button></main>;

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading club invite...</p>
      </div>
    );
  }

  // II accounts: the token is a club_domain PendingInvite id (email invite),
  // not a Supabase shareable link, so the join flow is real here — show an
  // accept card instead of the Supabase "shareable links disabled" notice.
  if (isIcp) {
    if (joined) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-6 text-center">
              {icpInviteClub?.logoUrl && (
                <Avatar className="h-14 w-14 mx-auto mb-3">
                  <AvatarImage src={icpInviteClub.logoUrl} alt={icpInviteClub.name} />
                  <AvatarFallback>{icpInviteClub.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              )}
              <h2 className="text-xl font-semibold mb-2">You've joined!</h2>
              <p className="text-muted-foreground mb-4">
                {icpInviteClub?.name
                  ? `Your invite to ${icpInviteClub.name} has been accepted.`
                  : "Your invite has been accepted."}
              </p>
              <Button onClick={() => navigate("/")}>Go to Home</Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            {icpInviteClub?.logoUrl && (
              <Avatar className="h-14 w-14 mx-auto mb-3">
                <AvatarImage src={icpInviteClub.logoUrl} alt={icpInviteClub.name} />
                <AvatarFallback>{icpInviteClub.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            <h2 className="text-xl font-semibold mb-2">
              {icpInviteClub?.name ? `Join ${icpInviteClub.name}` : "Club Invite"}
            </h2>
            <p className="text-muted-foreground mb-4">
              {user ? "Accept this invite to join the club." : "Sign in to accept this invite."}
            </p>
            <Button onClick={handleJoinClick} disabled={joinMutation.isPending}>
              {joinMutation.isPending ? "Joining..." : "Accept Invite"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Legacy web links use the same server-authorised acceptance as native links.
  if (!inviteError && invite) return <main className="min-h-screen flex items-center justify-center bg-background p-4"><Card className="w-full max-w-md"><CardContent className="p-6 text-center space-y-4"><h1 className="text-xl font-semibold">{joined ? "You've joined!" : `Join ${invite.clubs.name}`}</h1><p className="text-muted-foreground">{joined ? "Your club membership is confirmed." : `Invitation to join as ${roleLabels[invite.role as AppRole]}.`}</p><Button onClick={joined ? () => navigate("/") : handleJoinClick} disabled={joinMutation.isPending}>{joined ? "Go to Home" : joinMutation.isPending ? "Joining..." : user ? "Accept Invite" : "Create account or sign in"}</Button></CardContent></Card></main>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{inviteError ? "Couldn't check invitation" : "Invitation unavailable"}</h2>
          <p className="text-muted-foreground mb-4">
            Please reopen this link or ask your club administrator for a new invitation.
          </p>
          <Button onClick={() => navigate("/")}>Go to Home</Button>
        </CardContent>
      </Card>
    </div>
  );
}
