import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PWAInstallDialog } from "@/components/PWAInstallDialog";
import { PhotoConsentDialog } from "@/components/PhotoConsentDialog";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Basic User",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
};

// Roles that users can request when joining a team
const selectableRoles: AppRole[] = ["coach", "player", "parent"];

export default function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [joined, setJoined] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingJoinRoles, setPendingJoinRoles] = useState<AppRole[]>([]);
  const shouldPromptInstall = searchParams.get("install") === "true";

  // Fetch invite details using secure RPC function
  const { data: invite, isLoading: inviteLoading, error: inviteError } = useQuery({
    queryKey: ["team-invite", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_team_invite_by_token", { _token: token! });
      if (error) throw error;
      // Transform RPC result to match expected shape
      if (data && data.length > 0) {
        const row = data[0];
        return {
          id: row.id,
          team_id: row.team_id,
          role: row.role,
          token: row.token,
          uses_count: row.uses_count,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          created_at: row.created_at,
          created_by: row.created_by,
          teams: {
            id: row.team_id,
            name: row.team_name,
            logo_url: row.team_logo_url,
            club_id: row.club_id,
            clubs: {
              name: row.club_name
            }
          }
        };
      }
      return null;
    },
    enabled: !!token,
  });

  // Fetch user's existing roles in this team
  const { data: existingRoles } = useQuery({
    queryKey: ["user-team-roles", invite?.team_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("team_id", invite!.team_id);
      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: !!invite?.team_id && !!user,
  });

  // Initialize selected roles with invite role if user doesn't have it yet
  useEffect(() => {
    if (invite?.role && existingRoles && !existingRoles.includes(invite.role as AppRole)) {
      setSelectedRoles([invite.role as AppRole]);
    }
  }, [invite?.role, existingRoles]);

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  // Execute the actual join mutation
  const executeJoin = async (rolesToAdd: AppRole[]) => {
    if (!invite || !user) throw new Error("Missing data");

    // Check if invite is expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new Error("This invite link has expired");
    }

    // Check if max uses reached
    if (invite.max_uses && invite.uses_count >= invite.max_uses) {
      throw new Error("This invite link has reached its usage limit");
    }

    // Add user to team with all selected roles - insert one at a time to handle partial success
    for (const role of rolesToAdd) {
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        team_id: invite.team_id,
        club_id: invite.teams?.club_id,
        role: role,
      });
      
      // Ignore duplicate key errors (23505 is unique_violation), throw on other errors
      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key') || roleError.message.includes('unique constraint');
        if (!isDuplicate) {
          console.error('Role insert error:', roleError);
          throw new Error(`Failed to add ${role} role: ${roleError.message}`);
        }
      }
    }

    // Increment uses_count
    await supabase
      .from("team_invites")
      .update({ uses_count: invite.uses_count + 1 })
      .eq("id", invite.id);

    // Send notification to the new member
    const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "membership",
      message: `You've joined ${invite.teams?.name} as ${roleNames}`,
      related_id: invite.team_id,
    });

    return rolesToAdd;
  };

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!invite || !user) throw new Error("Missing data");

      // Filter out roles user already has
      const rolesToAdd = selectedRoles.filter(role => !existingRoles?.includes(role));

      if (rolesToAdd.length === 0) {
        throw new Error("You already have all selected roles in this team");
      }

      // If parent role is selected, check if we need to show consent dialog
      if (rolesToAdd.includes("parent")) {
        // Check if user has already given consent
        const { data: profile } = await supabase
          .from("profiles")
          .select("photo_consent_given_at")
          .eq("id", user.id)
          .single();

        if (!profile?.photo_consent_given_at) {
          // Store pending roles and show consent dialog
          setPendingJoinRoles(rolesToAdd);
          setShowPhotoConsent(true);
          return null; // Return null to indicate consent is pending
        }
      }

      return executeJoin(rolesToAdd);
    },
    onSuccess: (rolesToAdd) => {
      if (rolesToAdd === null) {
        // Consent dialog is being shown, don't proceed yet
        return;
      }
      setJoined(true);
      const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
      toast({ title: `Successfully joined as ${roleNames}!` });
      // Show PWA install prompt after successful join if install param was set
      if (shouldPromptInstall) {
        setShowInstallPrompt(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join team", variant: "destructive" });
    },
  });

  // Handle photo consent given
  const handlePhotoConsentGiven = async () => {
    if (!user) return;
    
    // Save consent to profile
    await supabase
      .from("profiles")
      .update({ photo_consent_given_at: new Date().toISOString() })
      .eq("id", user.id);

    setShowPhotoConsent(false);

    // Now complete the join with pending roles
    if (pendingJoinRoles.length > 0) {
      try {
        const result = await executeJoin(pendingJoinRoles);
        setJoined(true);
        const roleNames = result.map(r => roleLabels[r]).join(", ");
        toast({ title: `Successfully joined as ${roleNames}!` });
        if (shouldPromptInstall) {
          setShowInstallPrompt(true);
        }
      } catch (error) {
        toast({ title: (error as Error).message || "Failed to join team", variant: "destructive" });
      }
    }
    setPendingJoinRoles([]);
  };

  // Handle photo consent declined
  const handlePhotoConsentDeclined = () => {
    setShowPhotoConsent(false);
    setPendingJoinRoles([]);
    toast({ 
      title: "Photo consent required", 
      description: "You need to provide consent for your child's photos to join as a parent.",
      variant: "destructive" 
    });
  };

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      sessionStorage.setItem("redirectAfterAuth", `/join/${token}`);
      navigate("/auth");
    }
  }, [authLoading, user, token, navigate]);

  if (authLoading || inviteLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading team invite...</p>
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

  // Check if user already has all selectable roles
  const availableRoles = selectableRoles.filter(role => !existingRoles?.includes(role));
  const allRolesAssigned = availableRoles.length === 0;

  if (allRolesAssigned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Already a Full Member</h2>
            <p className="text-muted-foreground mb-4">
              You already have all available roles in {invite.teams?.name}.
            </p>
            <Button onClick={() => navigate(`/teams/${invite.team_id}`)}>View Team</Button>
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
            <h2 className="text-xl font-semibold mb-2">Welcome to the Team!</h2>
            <p className="text-muted-foreground mb-4">
              You've successfully joined {invite.teams?.name}.
            </p>
            <Button onClick={() => navigate(`/teams/${invite.team_id}`)}>View Team</Button>
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
              <AvatarImage src={invite.teams?.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                {invite.teams?.name?.charAt(0)?.toUpperCase() || "T"}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle>Join {invite.teams?.name}</CardTitle>
          {invite.teams?.clubs?.name && (
            <p className="text-muted-foreground text-sm">{invite.teams.clubs.name}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>Select your role(s) in this team:</span>
            </div>
            
            <div className="space-y-2 pl-1">
              {selectableRoles.map((role) => {
                const isDisabled = existingRoles?.includes(role);
                const isChecked = selectedRoles.includes(role);
                
                return (
                  <div key={role} className="flex items-center space-x-3">
                    <Checkbox
                      id={role}
                      checked={isChecked}
                      disabled={isDisabled}
                      onCheckedChange={() => toggleRole(role)}
                    />
                    <Label 
                      htmlFor={role} 
                      className={`flex items-center gap-2 cursor-pointer ${isDisabled ? 'opacity-50' : ''}`}
                    >
                      {roleLabels[role]}
                      {isDisabled && (
                        <Badge variant="outline" className="text-xs">Already assigned</Badge>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedRoles.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {selectedRoles.map(role => (
                <Badge key={role} variant="secondary">{roleLabels[role]}</Badge>
              ))}
            </div>
          )}

          <Button 
            onClick={() => joinMutation.mutate()} 
            disabled={joinMutation.isPending || selectedRoles.length === 0}
            className="w-full"
            size="lg"
          >
            {joinMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {selectedRoles.length === 0 ? "Select at least one role" : `Join as ${selectedRoles.length} role${selectedRoles.length > 1 ? 's' : ''}`}
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="w-full"
          >
            Cancel
          </Button>
        </CardContent>
      </Card>

      {/* Photo Consent Dialog for Parents */}
      <PhotoConsentDialog
        open={showPhotoConsent}
        onConsentGiven={handlePhotoConsentGiven}
        onDecline={handlePhotoConsentDeclined}
      />
    </div>
  );
}
