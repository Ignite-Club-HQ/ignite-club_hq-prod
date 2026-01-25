import { useState } from "react";
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
  const shouldPromptInstall = searchParams.get("install") === "true";
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();

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

  // Handle join action - show install prompt first, then redirect to auth if not logged in
  const handleJoinClick = async () => {
    // Try to install PWA first - await the user's choice before proceeding
    if (canPrompt && !isInstalled) {
      const installed = await installApp();
      // If PWA was installed, store the invite URL and show the guide
      if (installed) {
        // Store the invite URL so the PWA can resume the flow
        localStorage.setItem("pwa_pending_invite", `/join-club/${token}`);
        setShowInstalledGuide(true);
        return;
      }
    }
    
    // If not logged in, redirect to auth
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      navigate("/auth");
      return;
    }
    
    // User is logged in - proceed with join
    joinMutation.mutate();
  };

  // Handle "continue in browser" from installed guide
  const handleContinueInBrowser = () => {
    setShowInstalledGuide(false);
    localStorage.removeItem("pwa_pending_invite");
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", `/join-club/${token}`);
      navigate("/auth");
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

  if (inviteError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invite Link</h2>
            <p className="text-muted-foreground mb-4">
              This invite link is invalid or has been deleted.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if invite is expired
  const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
  const isMaxUsesReached = invite.max_uses && invite.uses_count >= invite.max_uses;

  if (isExpired || isMaxUsesReached) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Link Unavailable</h2>
            <p className="text-muted-foreground mb-4">
              {isExpired ? "This invite link has expired." : "This invite link has reached its usage limit."}
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user already has the invite role (only check if logged in)
  const alreadyHasRole = user && existingRoles?.includes(invite.role as AppRole);

  if (alreadyHasRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Already a Member</h2>
            <p className="text-muted-foreground mb-4">
              You already have the {roleLabels[invite.role as AppRole]} role in {invite.clubs?.name}.
            </p>
            <Button onClick={() => navigate(`/clubs/${invite.club_id}`)}>View Club</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Joined successfully
  if (joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Welcome to the Club!</h2>
            <p className="text-muted-foreground mb-4">
              You've successfully joined {invite.clubs?.name}.
            </p>
            <Button onClick={() => navigate(`/clubs/${invite.club_id}`)}>View Club</Button>
          </CardContent>
        </Card>
        
        {/* PWA Install Dialog for invite links */}
        <PWAInstallDialog 
          forceShow={showInstallPrompt} 
          onClose={() => setShowInstallPrompt(false)} 
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Avatar className="h-20 w-20 border-2 border-primary/20">
              <AvatarImage src={invite.clubs?.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                {invite.clubs?.name?.charAt(0)?.toUpperCase() || "C"}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle>Join {invite.clubs?.name}</CardTitle>
          {invite.clubs?.description && (
            <p className="text-muted-foreground text-sm mt-2">{invite.clubs.description}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">You'll join as:</span>
            <Badge variant="secondary">{roleLabels[invite.role as AppRole]}</Badge>
          </div>

          <Button 
            onClick={handleJoinClick} 
            disabled={joinMutation.isPending || authLoading}
            className="w-full"
            size="lg"
          >
            {(joinMutation.isPending || authLoading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {canPrompt && !isInstalled
              ? (!user ? "Install App & Sign in to Join" : `Install App & Join as ${roleLabels[invite.role as AppRole]}`)
              : (!user ? "Sign in to Join" : `Join as ${roleLabels[invite.role as AppRole]}`)}
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="w-full"
          >
            Cancel
          </Button>

          {/* iOS install instructions - show on join form if not installed */}
          {!isInstalled && isIOS && (
            <div className="border-t border-border pt-4 mt-4 space-y-3">
              <div className="flex items-center justify-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">Install the App</h3>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                For the best experience with push notifications and offline access
              </p>
              <IOSInstallGuide compact />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
