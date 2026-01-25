import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Building2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PWAInstallDialog } from "@/components/PWAInstallDialog";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { IOSInstallGuide } from "@/components/IOSInstallGuide";
import { PWAInstalledGuide } from "@/components/PWAInstalledGuide";
import { InviteFlowProgress, setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
};

export default function JoinClubPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [joined, setJoined] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showInstalledGuide, setShowInstalledGuide] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const autoJoinAttempted = useRef(false);
  const shouldPromptInstall = searchParams.get("install") === "true";
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();
  
  // Watch for installation completion - show guide only after app is actually installed
  useEffect(() => {
    if (isInstalling && isInstalled) {
      setIsInstalling(false);
      setShowInstalledGuide(true);
    }
  }, [isInstalling, isInstalled]);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = sessionStorage.getItem("autoJoinAfterAuth") === "true";

  // Fetch invite details using secure RPC function
  const { data: invite, isLoading: inviteLoading, error: inviteError } = useQuery({
    queryKey: ["club-invite", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_club_invite_by_token", { _token: token! });
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
    enabled: !!token,
  });

  // Fetch user's existing roles in this club
  const { data: existingRoles } = useQuery({
    queryKey: ["user-club-roles", invite?.club_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", invite!.club_id);
      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: !!invite?.club_id && !!user,
  });

  // Fetch user's profile to check if profile is complete
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile-for-join-club", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
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
        isIOS: isIOS,
        currentStep: resumeStep || "view",
      });
    }
  }, [invite, token, isIOS]);

  // Clear invite flow context on successful join
  useEffect(() => {
    if (joined) {
      clearInviteFlowContext();
    }
  }, [joined]);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!invite || !user) throw new Error("Missing data");

      // Check if invite is expired
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error("This invite link has expired");
      }

      // Check if max uses reached
      if (invite.max_uses && invite.uses_count >= invite.max_uses) {
        throw new Error("This invite link has reached its usage limit");
      }

      const roleToAdd = invite.role as AppRole;

      // Check if user already has this role
      if (existingRoles?.includes(roleToAdd)) {
        throw new Error(`You already have the ${roleLabels[roleToAdd]} role in this club`);
      }

      // Add user to club with the invite role
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        club_id: invite.club_id,
        role: roleToAdd,
      });

      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key');
        if (!isDuplicate) {
          throw new Error(`Failed to join: ${roleError.message}`);
        }
      }

      // Increment uses_count
      await supabase
        .from("club_invites")
        .update({ uses_count: invite.uses_count + 1 })
        .eq("id", invite.id);

      // Send notification to the new member
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "membership",
        message: `You've joined ${invite.clubs?.name} as ${roleLabels[roleToAdd]}`,
        related_id: invite.club_id,
      });

      return roleToAdd;
    },
    onSuccess: (role) => {
      setJoined(true);
      toast({ title: `Successfully joined as ${roleLabels[role]}!` });
      // Show PWA install prompt after successful join if install param was set
      if (shouldPromptInstall) {
        setShowInstallPrompt(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join club", variant: "destructive" });
    },
  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      sessionStorage.setItem("autoJoinAfterAuth", "true"); // Ensure flag is set
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
      sessionStorage.removeItem("autoJoinAfterAuth");
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [shouldAutoJoin, user, invite, userProfile, joined, joinMutation, token, navigate, profileLoading, inviteLoading]);

  // Handle join action - show install prompt first, then redirect to auth if not logged in
  const handleJoinClick = async () => {
    // On iOS, skip PWA install flow entirely
    if (!isIOS) {
      // Try to install PWA first - await the user's choice before proceeding
      if (canPrompt && !isInstalled) {
        setIsInstalling(true);
        // Store invite data and update flow context for install step
        localStorage.setItem("pwa_pending_invite", `/join-club/${token}`);
        sessionStorage.setItem("autoJoinAfterAuth", "true");
        
        // Update invite flow context to track we're at install step
        const existingContext = getInviteFlowContext();
        setInviteFlowContext({
          ...existingContext,
          active: true,
          currentStep: "install",
        });
        
        const accepted = await installApp();
        
        if (accepted) {
          // User accepted - keep isInstalling true, wait for appinstalled event
          // The useEffect watching isInstalled will handle showing the guide
          return;
        } else {
          // User declined - clean up and continue normal flow
          setIsInstalling(false);
          localStorage.removeItem("pwa_pending_invite");
        }
      }
    }
    
    // If not logged in, redirect to auth with auto-join flag
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      navigate("/auth");
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      // Store the club name as a label hint for profile completion
      if (invite?.clubs?.name) {
        // For club invites, we don't have an invited_label, but we could use user's Google name if available
        // Just ensure the redirect flow works - user will enter their own name
      }
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join
    joinMutation.mutate();
  };

  // Handle "continue in browser" from installed guide
  const handleContinueInBrowser = () => {
    setShowInstalledGuide(false);
    localStorage.removeItem("pwa_pending_invite");
    // Keep auto-join flag so they auto-join after auth or profile completion
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      navigate("/auth");
    } else if (!userProfile?.display_name) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      navigate("/complete-profile");
    } else {
      joinMutation.mutate();
    }
  };

  // Show installed guide if user just installed the PWA
  if (showInstalledGuide) {
    return <PWAInstalledGuide appName="Ignite" onDismiss={handleContinueInBrowser} />;
  }

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading club invite...</p>
      </div>
    );
  }

  // Club shareable invite links are no longer supported - only email invites work
  // This page handles /join-club/:token which are all shareable links
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Invite Links Disabled</h2>
          <p className="text-muted-foreground mb-4">
            Shareable invite links are no longer supported. Please ask your club admin to send you an email invite instead.
          </p>
          <Button onClick={() => navigate("/")}>Go to Home</Button>
        </CardContent>
      </Card>
    </div>
  );
}
