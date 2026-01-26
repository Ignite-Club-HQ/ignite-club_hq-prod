import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Users, AlertTriangle, Download, Share, PlusSquare, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PhotoConsentDialog } from "@/components/PhotoConsentDialog";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { IOSInstallGuide } from "@/components/IOSInstallGuide";
import { PWAInstalledGuide } from "@/components/PWAInstalledGuide";
import { InviteFlowProgress, setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
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

// Roles that don't allow additional role selection (admin roles)
const fixedRoles: AppRole[] = ["club_admin", "team_admin", "app_admin"];

export default function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [joined, setJoined] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingJoinRoles, setPendingJoinRoles] = useState<AppRole[]>([]);
  const [nameValidationError, setNameValidationError] = useState<string | null>(null);
  const [showInstalledGuide, setShowInstalledGuide] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const autoJoinAttempted = useRef(false);
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();
  
  // Watch for installation completion - show guide only after app is actually installed
  useEffect(() => {
    console.log("[JoinTeam] Install state check - isInstalling:", isInstalling, "isInstalled:", isInstalled);
    if (isInstalling && isInstalled) {
      // App finished installing - show the installed guide
      console.log("[JoinTeam] Installation complete, showing guide");
      setIsInstalling(false);
      setShowInstalledGuide(true);
    }
  }, [isInstalling, isInstalled]);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = sessionStorage.getItem("autoJoinAfterAuth") === "true";

  // Check if this is a pending invite token (name-restricted) or a regular team invite
  const isPendingInvite = location.pathname.startsWith("/join/p/");

  // Fetch pending invite details using RPC function (for name-restricted invites)
  const { data: pendingInviteData, isLoading: pendingInviteLoading, error: pendingInviteError, isError: pendingInviteIsError } = useQuery({
    queryKey: ["pending-invite-token", token],
    queryFn: async () => {
      console.log("[JoinTeam] Fetching pending invite for token:", token);
      try {
        const { data, error } = await supabase
          .rpc("get_pending_invite_by_token", { _token: token! });
        console.log("[JoinTeam] RPC response:", { data, error });
        if (error) {
          console.error("[JoinTeam] RPC error:", error);
          throw error;
        }
        if (data && data.length > 0) {
          return data[0];
        }
        console.log("[JoinTeam] No invite found for token");
        return null;
      } catch (err) {
        console.error("[JoinTeam] Exception fetching invite:", err);
        throw err;
      }
    },
    enabled: !!token && isPendingInvite,
    retry: 2,
    retryDelay: 1000,
    staleTime: 0,
  });

  // Fetch team invite details using secure RPC function (for regular invites)
  const { data: teamInvite, isLoading: teamInviteLoading, error: teamInviteError } = useQuery({
    queryKey: ["team-invite", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_team_invite_by_token", { _token: token! });
      if (error) throw error;
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
              name: row.club_name,
              logo_url: undefined as string | undefined
            }
          }
        };
      }
      return null;
    },
    enabled: !!token && !isPendingInvite,
  });

  // Combine invite data based on type
  const invite = isPendingInvite 
    ? pendingInviteData 
      ? {
          id: pendingInviteData.id,
          team_id: pendingInviteData.team_id,
          role: pendingInviteData.role,
          invited_label: pendingInviteData.invited_label,
          status: pendingInviteData.status,
          token: token,
          uses_count: 0,
          max_uses: 1, // Pending invites are single-use
          expires_at: null,
          created_at: null,
          created_by: null,
          teams: {
            id: pendingInviteData.team_id,
            name: pendingInviteData.team_name,
            logo_url: pendingInviteData.team_logo_url,
            club_id: pendingInviteData.club_id,
            clubs: {
              name: pendingInviteData.club_name,
              logo_url: pendingInviteData.club_logo_url
            }
          }
        }
      : null
    : teamInvite;

  const isLoading = isPendingInvite ? pendingInviteLoading : teamInviteLoading;
  const inviteError = isPendingInvite ? pendingInviteError : teamInviteError;

  // Loading timeout - if loading takes more than 10 seconds, show error
  useEffect(() => {
    if (isLoading) {
      console.log("[JoinTeam] Loading started, isPendingInvite:", isPendingInvite, "token:", token);
      const timeout = setTimeout(() => {
        console.log("[JoinTeam] Loading timeout reached");
        setLoadingTimeout(true);
      }, 10000);
      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [isLoading, isPendingInvite, token]);

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

  // Fetch user's profile for name validation and profile completion check
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile-for-join", user?.id],
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

  // Validate name for pending invites - only block EXISTING users with a different name already set
  // New signups (no display_name yet) are allowed - their name will be auto-set during join
  useEffect(() => {
    if (isPendingInvite && pendingInviteData?.invited_label && user && userProfile !== undefined) {
      const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
      const actualName = (userProfile?.display_name || "").toLowerCase().trim();
      
      // Only block if user has an EXISTING display_name that doesn't match
      // If display_name is empty, they're a new signup and we'll set their name during join
      if (actualName && actualName !== expectedName) {
        setNameValidationError(
          `This invite was created for "${pendingInviteData.invited_label}". Your account name "${userProfile?.display_name}" doesn't match.`
        );
      } else {
        // Either name matches OR they have no display_name yet (new signup) - allow join
        setNameValidationError(null);
      }
    } else {
      setNameValidationError(null);
    }
  }, [isPendingInvite, pendingInviteData, userProfile, user]);

  // Set up invite flow context when invite is loaded (for progress tracking across pages)
  useEffect(() => {
    if (invite) {
      // Check if we're resuming from a stored context (e.g., after PWA install)
      const existingContext = getInviteFlowContext();
      const resumeStep = existingContext?.currentStep;
      
      setInviteFlowContext({
        active: true,
        clubName: invite.teams?.clubs?.name || undefined,
        clubLogoUrl: invite.teams?.clubs?.logo_url || undefined,
        teamName: invite.teams?.name || undefined,
        role: invite.role,
        inviteToken: token,
        isIOS: isIOS,
        // Preserve current step if resuming, otherwise start at 'view'
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

  // Check if this is a fixed role invite:
  // - Admin roles don't allow additional selection
  // - Pending invites (email-based) always use the role chosen by the inviter
  const isFixedRoleInvite = invite?.role && (fixedRoles.includes(invite.role as AppRole) || isPendingInvite);

  // Initialize selected roles with invite role if user doesn't have it yet
  useEffect(() => {
    if (invite?.role && existingRoles && !existingRoles.includes(invite.role as AppRole)) {
      // For fixed role invites, only set the fixed role
      if (isFixedRoleInvite) {
        setSelectedRoles([invite.role as AppRole]);
      } else {
        setSelectedRoles([invite.role as AppRole]);
      }
    }
  }, [invite?.role, existingRoles, isFixedRoleInvite]);

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

    // For pending invites, validate name match
    if (isPendingInvite && pendingInviteData?.invited_label) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
      const actualName = (profile?.display_name || "").toLowerCase().trim();

      // If user has no display_name, set it to the expected name
      if (!profile?.display_name || !actualName) {
        await supabase
          .from("profiles")
          .update({ display_name: pendingInviteData.invited_label })
          .eq("id", user.id);
      } else if (actualName !== expectedName) {
        const adminType = pendingInviteData.team_id ? "team admin" : "club admin";
        throw new Error(
          `This invite was created for "${pendingInviteData.invited_label}". Please create a new account with that name or contact your ${adminType} for a different invite link.`
        );
      }

      // Check if pending invite is already used
      if (pendingInviteData.status !== "pending") {
        throw new Error("This invite has already been used");
      }

      // Mark the pending invite as accepted
      await supabase
        .from("pending_invites")
        .update({ 
          status: "accepted", 
          accepted_at: new Date().toISOString(),
          invited_user_id: user.id
        })
        .eq("id", pendingInviteData.id);

      // Create children from invite metadata (if parent role with children)
      console.log("[JoinTeam] Checking for children in metadata.");
      console.log("[JoinTeam] Role:", pendingInviteData.role, "Type:", typeof pendingInviteData.role);
      console.log("[JoinTeam] Raw metadata:", JSON.stringify(pendingInviteData.metadata));
      console.log("[JoinTeam] Metadata type:", typeof pendingInviteData.metadata);
      
      const metadata = pendingInviteData.metadata as { children?: { name: string; yearOfBirth: number | null }[] } | null;
      console.log("[JoinTeam] Parsed metadata:", JSON.stringify(metadata));
      console.log("[JoinTeam] Children array:", JSON.stringify(metadata?.children));
      console.log("[JoinTeam] Children length:", metadata?.children?.length);
      console.log("[JoinTeam] Role check (parent):", pendingInviteData.role === "parent");
      
      if (metadata?.children && metadata.children.length > 0 && pendingInviteData.role === "parent") {
        console.log("[JoinTeam] ✅ Entering child creation loop for:", metadata.children.length, "children");
        for (const childData of metadata.children) {
          console.log("[JoinTeam] Creating child:", childData.name, "YoB:", childData.yearOfBirth, "for parent:", user.id);
          // Create the child record
          const { data: newChild, error: childError } = await supabase
            .from("children")
            .insert({
              parent_id: user.id,
              name: childData.name,
              year_of_birth: childData.yearOfBirth,
            })
            .select("id")
            .single();
          
          if (childError) {
            console.error("[JoinTeam] ❌ Failed to create child:", childError.message, childError.code, childError.details);
            continue;
          }
          
          console.log("[JoinTeam] ✅ Child created with ID:", newChild?.id);
          
          // Assign child to the team
          if (newChild?.id && pendingInviteData.team_id) {
            console.log("[JoinTeam] Assigning child to team:", pendingInviteData.team_id);
            const { error: assignError } = await supabase
              .from("child_team_assignments")
              .insert({
                child_id: newChild.id,
                team_id: pendingInviteData.team_id,
              });
            
            if (assignError) {
              console.error("[JoinTeam] ❌ Failed to assign child to team:", assignError.message, assignError.code);
            } else {
              console.log("[JoinTeam] ✅ Child created and assigned to team:", childData.name);
            }
          }
        }
      } else {
        console.log("[JoinTeam] ⚠️ Skipping child creation. Conditions not met:");
        console.log("  - metadata?.children:", !!metadata?.children);
        console.log("  - children.length > 0:", (metadata?.children?.length || 0) > 0);
        console.log("  - role === 'parent':", pendingInviteData.role === "parent");
      }
    } else if (!isPendingInvite) {
      // Regular team invite - check expiry and usage limits
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error("This invite link has expired");
      }

      if (invite.max_uses && invite.uses_count >= invite.max_uses) {
        throw new Error("This invite link has reached its usage limit");
      }

      // Check for a matching pending invite to get the invited_label (legacy flow)
      const { data: pendingInvite } = await supabase
        .from("pending_invites")
        .select("id, invited_label")
        .eq("team_id", invite.team_id)
        .eq("status", "pending")
        .or(`invited_user_id.eq.${user.id},invited_label.ilike.%${user.email?.split('@')[0]}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // If there's a pending invite with a label and user has no display_name, prefill it
      if (pendingInvite?.invited_label) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .single();

        if (!profile?.display_name) {
          await supabase
            .from("profiles")
            .update({ display_name: pendingInvite.invited_label })
            .eq("id", user.id);
        }

        // Mark the pending invite as accepted
        await supabase
          .from("pending_invites")
          .update({ 
            status: "accepted", 
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id
          })
          .eq("id", pendingInvite.id);
      }

      // Increment uses_count for team invite
      await supabase
        .from("team_invites")
        .update({ uses_count: invite.uses_count + 1 })
        .eq("id", invite.id);
    }

    // Add user to team with all selected roles
    for (const role of rolesToAdd) {
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        team_id: invite.team_id,
        club_id: invite.teams?.club_id,
        role: role,
      });
      
      // Ignore duplicate key errors
      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key') || roleError.message.includes('unique constraint');
        if (!isDuplicate) {
          console.error('Role insert error:', roleError);
          throw new Error(`Failed to add ${role} role: ${roleError.message}`);
        }
      }
    }

    // Send notification to the new member
    const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "membership",
      message: `You've joined ${invite.teams?.name} as ${roleNames}`,
      related_id: invite.team_id,
    });

    // Send membership confirmation email if user has an email
    if (user.email) {
      try {
        // Fetch club branding for the email
        const clubId = invite.teams?.club_id;
        let clubLogoUrl: string | undefined;
        let clubName = invite.teams?.clubs?.name || "Your Club";
        
        if (clubId) {
          const { data: clubBranding } = await supabase
            .from("clubs")
            .select("name, logo_url")
            .eq("id", clubId)
            .single();
          
          if (clubBranding) {
            clubName = clubBranding.name || clubName;
            clubLogoUrl = clubBranding.logo_url || undefined;
          }
        }

        const teamLink = `${window.location.origin}/team/${invite.team_id}`;
        
        console.log("Sending membership email with:", { clubName, clubLogoUrl, teamName: invite.teams?.name });
        
        await supabase.functions.invoke("send-email", {
          body: {
            to: user.email,
            subject: `Welcome to ${invite.teams?.name}!`,
            template: "membership-confirmation",
            templateData: {
              recipientName: userProfile?.display_name || pendingInviteData?.invited_label || user.email.split("@")[0],
              teamName: invite.teams?.name || "the team",
              clubName,
              roleName: roleNames,
              teamLink,
              clubLogoUrl,
            },
          },
        });
        console.log("Membership confirmation email sent to", user.email);
      } catch (emailError) {
        // Don't fail the join if email fails
        console.error("Failed to send membership confirmation email:", emailError);
      }
    }

    return rolesToAdd;
  };

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!invite || !user) throw new Error("Missing data");

      // Block join if there's a name validation error
      if (nameValidationError) {
        throw new Error(nameValidationError);
      }

      // Filter out roles user already has
      const rolesToAdd = selectedRoles.filter(role => !existingRoles?.includes(role));

      if (rolesToAdd.length === 0) {
        throw new Error("You already have all selected roles in this team");
      }

      // If parent role is selected, check if we need to show consent dialog
      if (rolesToAdd.includes("parent")) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("photo_consent_given_at")
          .eq("id", user.id)
          .single();

        if (!profile?.photo_consent_given_at) {
          setPendingJoinRoles(rolesToAdd);
          setShowPhotoConsent(true);
          return null;
        }
      }

      return executeJoin(rolesToAdd);
    },
    onSuccess: (rolesToAdd) => {
      if (rolesToAdd === null) {
        return;
      }
      setJoined(true);
      const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
      toast({ title: `Successfully joined as ${roleNames}!` });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join team", variant: "destructive" });
    },
  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true"); // Ensure flag is set
      // Store the invited_label for profile prefill if available (pending invite)
      if (pendingInviteData?.invited_label) {
        sessionStorage.setItem("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile", { replace: true });
      return;
    }

    // Wait for invite data to load before attempting auto-join
    if (isLoading) return;

    if (
      shouldAutoJoin && 
      user && 
      invite && 
      existingRoles !== undefined && // Wait for existing roles to load
      userProfile?.display_name && // Only auto-join if profile is complete
      !joined && 
      !joinMutation.isPending &&
      !autoJoinAttempted.current &&
      !nameValidationError
    ) {
      // Calculate roles to add - use invite role if user doesn't have it
      const inviteRole = invite.role as AppRole;
      const hasInviteRole = existingRoles?.includes(inviteRole);
      
      if (hasInviteRole) {
        // User already has this role - just navigate to team
        autoJoinAttempted.current = true;
        sessionStorage.removeItem("autoJoinAfterAuth");
        toast({ title: `You're already a member of ${invite.teams?.name}!` });
        setJoined(true);
        return;
      }
      
      // Set the role before joining
      if (selectedRoles.length === 0) {
        setSelectedRoles([inviteRole]);
        return; // Let the effect re-run after selectedRoles is set
      }
      
      autoJoinAttempted.current = true;
      sessionStorage.removeItem("autoJoinAfterAuth");
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [shouldAutoJoin, user, invite, existingRoles, selectedRoles, joined, joinMutation, nameValidationError, toast, userProfile, location.pathname, navigate, profileLoading, isLoading, pendingInviteData]);

  // Handle photo consent given
  const handlePhotoConsentGiven = async () => {
    if (!user) return;
    
    await supabase
      .from("profiles")
      .update({ photo_consent_given_at: new Date().toISOString() })
      .eq("id", user.id);

    setShowPhotoConsent(false);

    if (pendingJoinRoles.length > 0) {
      try {
        const result = await executeJoin(pendingJoinRoles);
        setJoined(true);
        const roleNames = result.map(r => roleLabels[r]).join(", ");
        toast({ title: `Successfully joined as ${roleNames}!` });
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

  // Handle join action - redirect to auth if not logged in
  const handleJoinClick = async () => {
    // On iOS, skip PWA install flow entirely - go straight to auth
    // iOS can't programmatically trigger install, so we'll show IOSInstallPrompt after signup
    if (!isIOS) {
      // Try to install PWA first - await the user's choice before proceeding
      if (canPrompt && !isInstalled) {
        setIsInstalling(true);
        // Store invite data and update flow context for install step
        localStorage.setItem("pwa_pending_invite", location.pathname);
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
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      // Signal to auth page that this is a new user (coming from invite)
      sessionStorage.setItem("authDefaultTab", "signup");
      navigate("/auth");
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      // Store the invited_label for profile prefill if available (pending invite)
      if (pendingInviteData?.invited_label) {
        sessionStorage.setItem("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join (may need photo consent for parent role)
    joinMutation.mutate();
  };

  // Handle "continue in browser" from installed guide
  const handleContinueInBrowser = () => {
    setShowInstalledGuide(false);
    localStorage.removeItem("pwa_pending_invite");
    // Keep auto-join flag so they auto-join after auth or profile completion
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      navigate("/auth");
    } else if (!userProfile?.display_name) {
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      // Store the invited_label for profile prefill if available (pending invite)
      if (pendingInviteData?.invited_label) {
        sessionStorage.setItem("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile");
    } else {
      joinMutation.mutate();
    }
  };

  // Show installing progress screen
  if (isInstalling) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <InviteFlowProgress currentStep="install" isIOS={isIOS} className="fixed top-0 left-0 right-0 z-50" />
        <div className="flex-1 flex items-center justify-center p-4 pt-16">
          <Card className="w-full max-w-md">
            <CardContent className="p-6 text-center space-y-6">
              {/* App icon with loading overlay */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                    <img 
                      src="/ignite-logo.png" 
                      alt="Ignite app icon"
                      className="h-16 w-16 rounded-xl"
                    />
                  </div>
                  {/* Loading spinner overlay */}
                  <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-background border-2 border-primary flex items-center justify-center">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Installing Ignite...</h2>
                <p className="text-muted-foreground">
                  Please wait while the app is being added to your home screen.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Download className="h-4 w-4 animate-bounce" />
                <span>This will only take a moment...</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  // Show installing state while app is being installed
  if (isInstalling && !isInstalled) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <InviteFlowProgress 
          currentStep="install" 
          isIOS={isIOS}
          isExistingUser={false}
          className="fixed top-0 left-0 right-0"
        />
        <div className="flex-1 flex items-center justify-center p-4 pt-16">
          <Card className="w-full max-w-md">
            <CardContent className="p-8 text-center space-y-6">
              <div className="relative mx-auto w-24 h-24">
                <img 
                  src="/ignite-logo.png" 
                  alt="Ignite" 
                  className="w-full h-full object-contain"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-28 h-28 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Installing App...</h2>
                <p className="text-muted-foreground">
                  Please wait while Ignite is added to your home screen.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show installed guide if user just installed the PWA
  if (showInstalledGuide) {
    return <PWAInstalledGuide appName="Ignite" onDismiss={handleContinueInBrowser} />;
  }

  if (isLoading && !loadingTimeout) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading team invite...</p>
      </div>
    );
  }

  // Handle loading timeout - show error and retry option
  if (loadingTimeout && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Taking Too Long</h2>
            <p className="text-muted-foreground mb-4">
              We're having trouble loading this invite. This might be a network issue.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Block regular invite links - only email invites (pending invites) are now allowed
  if (!isPendingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Links Disabled</h2>
            <p className="text-muted-foreground mb-4">
              Shareable invite links are no longer supported. Please ask your team admin to send you an email invite instead.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
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

  // Check if pending invite is already used
  if (pendingInviteData?.status !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Already Used</h2>
            <p className="text-muted-foreground mb-4">
              This invite link has already been used. Contact your {pendingInviteData?.team_id ? "team admin" : "club admin"} for a new invite.
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
    const handleInstall = async () => {
      await installApp();
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-6">
            {/* Success message */}
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Welcome to the Team!</h2>
              <p className="text-muted-foreground">
                You've successfully joined {invite.teams?.name}.
              </p>
            </div>

            {/* App install instructions - only show if not already installed */}
            {!isInstalled && (
              <div className="border-t border-border pt-4 space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  <h3 className="font-medium">Install the App</h3>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Get the best experience with push notifications and offline access!
                </p>

                {isIOS ? (
                  // iOS instructions
                  <div className="space-y-2 bg-muted/50 rounded-lg p-4">
                    <p className="text-sm font-medium text-center mb-3">Add to your home screen:</p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">1</span>
                        <span className="flex items-center gap-2">
                          Tap the <Share className="h-4 w-4 text-primary" /> Share button
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">2</span>
                        <span className="flex items-center gap-2">
                          Tap <PlusSquare className="h-4 w-4 text-primary" /> "Add to Home Screen"
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">3</span>
                        <span>Tap "Add" to install</span>
                      </div>
                    </div>
                  </div>
                ) : canPrompt ? (
                  // Android/Chrome can prompt directly
                  <Button onClick={handleInstall} className="w-full" variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Install App
                  </Button>
                ) : (
                  // Fallback instructions for other browsers
                  <div className="space-y-2 bg-muted/50 rounded-lg p-4">
                    <p className="text-sm text-muted-foreground text-center">
                      Look for "Add to Home Screen" or "Install App" in your browser menu.
                    </p>
                  </div>
                )}
              </div>
            )}

            <Button onClick={() => navigate(`/teams/${invite.team_id}`)} className="w-full" size="lg">
              View Team
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine current step for progress indicator
  const getCurrentStep = (): "view" | "install" | "auth" | "profile" | "done" => {
    if (showInstalledGuide) return "install";
    if (isInstalling) return "install";
    
    // Check if we're in standalone mode (PWA) and should show auth step
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone && !user) {
      // User opened PWA and needs to sign up
      return "auth";
    }
    
    // Check stored context for resume step
    const storedContext = getInviteFlowContext();
    if (storedContext?.currentStep && storedContext.currentStep !== "view") {
      return storedContext.currentStep;
    }
    
    return "view";
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Fixed progress indicator at top */}
      <InviteFlowProgress 
        currentStep={getCurrentStep()} 
        isIOS={isIOS}
        isExistingUser={!!user}
        className="fixed top-0 left-0 right-0"
      />
      
      <div className="flex-1 flex items-center justify-center p-4 pt-16">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Avatar className="h-20 w-20 border-2 border-primary/20">
              <AvatarImage src={invite.teams?.logo_url || invite.teams?.clubs?.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                {(invite.teams?.name || invite.teams?.clubs?.name)?.charAt(0)?.toUpperCase() || "T"}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle>Join {invite.teams?.name || invite.teams?.clubs?.name}</CardTitle>
          {invite.teams?.clubs?.name && invite.teams?.name && (
            <p className="text-muted-foreground text-sm">{invite.teams.clubs.name}</p>
          )}
          {isPendingInvite && pendingInviteData?.invited_label && (
            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                Invite for: <span className="font-medium text-foreground">{pendingInviteData.invited_label}</span>
              </p>
              {!user && (
                <p className="text-xs text-muted-foreground">
                  Create an account to join as {pendingInviteData.invited_label}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name validation warning - existing user trying to use new-signup-only link */}
          {nameValidationError && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Link Not Valid For Existing Users</p>
                <p className="text-muted-foreground mt-1">{nameValidationError}</p>
                <p className="text-muted-foreground mt-2">
                  Contact your {invite?.team_id ? "team admin" : "club admin"} to be added directly or to receive a general invite link.
                </p>
              </div>
            </div>
          )}

          {/* Fixed role display for admin invites - no role selection */}
          {isFixedRoleInvite ? (
            <div className="flex items-center justify-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">You'll join as:</span>
              <Badge variant="secondary">{roleLabels[invite.role as AppRole]}</Badge>
            </div>
          ) : (
            /* Role selection for non-admin invites */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>Select your role(s) in this team:</span>
              </div>
              
              <div className="space-y-2 pl-1">
                {selectableRoles.map((role) => {
                  const isDisabled = existingRoles?.includes(role) || !!nameValidationError;
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
                        {existingRoles?.includes(role) && (
                          <Badge variant="outline" className="text-xs">Already assigned</Badge>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </div>

              {selectedRoles.length > 0 && !nameValidationError && (
                <div className="flex flex-wrap gap-1 justify-center">
                  {selectedRoles.map(role => (
                    <Badge key={role} variant="secondary">{roleLabels[role]}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button 
            onClick={handleJoinClick} 
            disabled={isInstalling || joinMutation.isPending || (user && profileLoading) || (user && selectedRoles.length === 0 && !needsProfileCompletion) || (user && !!nameValidationError)}
            className="w-full"
            size="lg"
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Installing App...
              </>
            ) : isInstalled && !user ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2 text-primary-foreground" />
                App Installed - Create Account
              </>
            ) : (joinMutation.isPending || (user && profileLoading)) ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            {!isInstalling && !(isInstalled && !user) && !joinMutation.isPending && !(user && profileLoading) && (
              !user 
                ? (canPrompt && !isInstalled 
                    ? "Install App & Create Account"
                    : "Create Account to Join")
                : nameValidationError 
                  ? "Cannot Join - Name Mismatch"
                  : needsProfileCompletion
                    ? "Complete Profile to Join"
                    : isFixedRoleInvite
                      ? `Join as ${roleLabels[invite.role as AppRole]}`
                      : selectedRoles.length === 0 
                        ? "Select at least one role" 
                        : `Join as ${selectedRoles.length} role${selectedRoles.length > 1 ? 's' : ''}`
            )}
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="w-full"
          >
            Cancel
          </Button>

          {/* iOS install instructions - show on join form if not installed (iOS can't prompt directly) */}
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

      {/* Photo Consent Dialog for Parents */}
      <PhotoConsentDialog
        open={showPhotoConsent}
        onConsentGiven={handlePhotoConsentGiven}
        onDecline={handlePhotoConsentDeclined}
      />
    </div>
  );
}
