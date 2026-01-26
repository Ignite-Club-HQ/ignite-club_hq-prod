import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Flame, User, Camera, Loader2, Bell, Download, Fingerprint, UserPlus, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToPushNotifications, checkPushSubscription } from "@/lib/pushNotifications";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { usePasskey, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";
import { InviteFlowProgress, getInviteFlowContext, clearInviteFlowContext, hasCompletedProfile } from "@/components/InviteFlowProgress";

interface PendingInvite {
  id: string;
  team_id: string | null;
  club_id: string | null;
  role: string;
  invited_label: string | null;
  club_name?: string;
  team_name?: string;
}

export default function CompleteProfilePage() {
  const { user, profile, loading: authLoading, profileLoading, profileError, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const [installAndContinue, setInstallAndContinue] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsLoading, setBiometricsLoading] = useState(false);
  const [showOpenAppMessage, setShowOpenAppMessage] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [acceptInvites, setAcceptInvites] = useState(true);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { canPrompt, isInstalled, installApp, isReady: pwaReady, isIOS } = usePWAInstall();
  const { registerPasskey } = usePasskey();

  // Check if we're in an invite flow - but respect the hard rule
  const inviteFlowContext = hasCompletedProfile() ? null : getInviteFlowContext();

  // Check if push notifications and biometrics are supported
  useEffect(() => {
    const checkFeatures = async () => {
      // Check push support
      const hasPush = typeof window !== 'undefined' && 
                      'PushManager' in window && 
                      'serviceWorker' in navigator &&
                      'Notification' in window;
      console.log('[CompleteProfile] Push support check:', { hasPush, PushManager: 'PushManager' in window, serviceWorker: 'serviceWorker' in navigator, Notification: 'Notification' in window });
      setPushSupported(hasPush);
      
      // Check biometrics availability
      try {
        const available = await isPlatformAuthenticatorAvailable();
        console.log('[CompleteProfile] Biometrics available:', available);
        setBiometricsAvailable(available);
      } catch (err) {
        console.log('[CompleteProfile] Biometrics check error:', err);
        setBiometricsAvailable(false);
      }
    };
    
    checkFeatures();
  }, []);

  // Fetch pending invites for the user's email
  useEffect(() => {
    const fetchPendingInvites = async () => {
      if (!user?.email || authLoading) return;
      
      setInvitesLoading(true);
      const userEmail = user.email.toLowerCase();
      console.log('[CompleteProfile] Fetching pending invites for:', userEmail);
      
      try {
        // Use RPC or direct query - the RLS policy should allow this
        const { data: invites, error } = await supabase
          .from("pending_invites")
          .select(`
            id,
            team_id,
            club_id,
            role,
            invited_label,
            clubs:club_id(name),
            teams:team_id(name)
          `)
          .ilike("invited_email", userEmail)
          .eq("status", "pending");
        
        if (error) {
          console.error('[CompleteProfile] Error fetching pending invites:', error);
        } else if (invites && invites.length > 0) {
          console.log('[CompleteProfile] Found pending invites:', invites);
          const formattedInvites: PendingInvite[] = invites.map((inv: any) => ({
            id: inv.id,
            team_id: inv.team_id,
            club_id: inv.club_id,
            role: inv.role,
            invited_label: inv.invited_label,
            club_name: inv.clubs?.name,
            team_name: inv.teams?.name,
          }));
          setPendingInvites(formattedInvites);
        } else {
          console.log('[CompleteProfile] No pending invites found');
        }
      } catch (err) {
        console.error('[CompleteProfile] Exception fetching invites:', err);
      } finally {
        setInvitesLoading(false);
      }
    };
    
    fetchPendingInvites();
  }, [user?.email, authLoading]);

  // Initialize form values once loading is complete, with pending invite prefill
  useEffect(() => {
    const initializeProfile = async () => {
      if (authLoading || profileLoading || initialized) return;
      
      // Initialize with existing profile data if available
      let prefillName = profile?.display_name || "";
      const prefillAvatar = profile?.avatar_url || "";
      
      // If no display name, use invite label or sessionStorage
      if (!prefillName) {
        // Check pending invites we already fetched
        const inviteWithLabel = pendingInvites.find(inv => inv.invited_label);
        if (inviteWithLabel?.invited_label) {
          prefillName = inviteWithLabel.invited_label;
        }
        
        // If still no name, check sessionStorage
        if (!prefillName) {
          const storedInviteLabel = sessionStorage.getItem("inviteLabel");
          if (storedInviteLabel) {
            prefillName = storedInviteLabel;
          }
        }
      }
      
      setDisplayName(prefillName);
      setAvatarUrl(prefillAvatar);
      setInitialized(true);
    };
    
    initializeProfile();
  }, [authLoading, profileLoading, profile, initialized, pendingInvites]);

  // Show loading while auth, profile, or PWA detection is loading
  if (authLoading || profileLoading || !pwaReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="p-4 rounded-2xl bg-primary">
          <Flame className="h-10 w-10 text-primary-foreground" />
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  // Redirect to auth if not logged in
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // If there was an error loading profile, redirect to home for retry handling
  if (profileError) {
    return <Navigate to="/" replace />;
  }

  // If profile exists and already has display_name, redirect to home
  if (profile?.display_name) {
    return <Navigate to="/" replace />;
  }

  // Show the form for:
  // 1. New users (profile is null) - will create profile
  // 2. Existing users with no display_name - will update profile

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please select an image file.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    // For MVP, we'll use a placeholder. In production, implement storage bucket
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarUrl(reader.result as string);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter your display name.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      // Use upsert to handle both new users (insert) and existing users (update)
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          display_name: displayName.trim(),
          avatar_url: avatarUrl || null,
        }, { onConflict: 'id' });

      if (error) {
        console.error("Profile update error:", error);
        toast({
          title: "Error",
          description: "Failed to update profile. Please try again.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      // Process pending invites if user opted in
      if (acceptInvites && pendingInvites.length > 0) {
        console.log("[CompleteProfile] Processing pending invites:", pendingInvites.length);
        
        for (const invite of pendingInvites) {
          console.log("[CompleteProfile] Processing invite:", invite.id, "role:", invite.role);
          
          // Get club_id from team if this is a team invite
          let clubId = invite.club_id;
          if (invite.team_id && !clubId) {
            const { data: team } = await supabase
              .from("teams")
              .select("club_id")
              .eq("id", invite.team_id)
              .single();
            clubId = team?.club_id;
          }

          // Check if role already exists
          const roleQuery = supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("role", invite.role as any);
          
          if (invite.team_id) {
            roleQuery.eq("team_id", invite.team_id);
          } else if (clubId) {
            // Club-only role (no team)
            roleQuery.eq("club_id", clubId).is("team_id", null);
          }
          
          const { data: existingRole } = await roleQuery.maybeSingle();

          if (!existingRole) {
            // Insert the role
            const { error: roleError } = await supabase
              .from("user_roles")
              .insert({
                user_id: user.id,
                role: invite.role as any,
                team_id: invite.team_id || null,
                club_id: clubId || null,
              });

            if (roleError) {
              console.error("[CompleteProfile] Failed to assign role from invite:", roleError);
              toast({
                title: "Role assignment failed",
                description: `Could not assign ${invite.role} role. You may need to use the invite link again.`,
                variant: "destructive",
              });
            } else {
              console.log("[CompleteProfile] Successfully assigned role:", invite.role);
              
              // Mark the invite as accepted and update invited_user_id
              const { error: updateError } = await supabase
                .from("pending_invites")
                .update({ 
                  status: "accepted", 
                  accepted_at: new Date().toISOString(),
                  invited_user_id: user.id 
                })
                .eq("id", invite.id);
              
              if (updateError) {
                console.error("[CompleteProfile] Failed to update invite status:", updateError);
              } else {
                const entityName = invite.team_name || invite.club_name || "organization";
                toast({
                  title: "Invite accepted!",
                  description: `You've joined ${entityName} as ${invite.role.replace("_", " ")}.`,
                });
              }
            }
          } else {
            console.log("[CompleteProfile] Role already exists, skipping:", invite.role);
            // Still mark invite as accepted
            await supabase
              .from("pending_invites")
              .update({ 
                status: "accepted", 
                accepted_at: new Date().toISOString(),
                invited_user_id: user.id 
              })
              .eq("id", invite.id);
          }
        }
      } else if (pendingInvites.length > 0) {
        console.log("[CompleteProfile] User opted out of accepting invites");
      } else {
        console.log("[CompleteProfile] No pending invites to process");
      }

      // If user opted in for push notifications, subscribe them
      if (pushEnabled && pushSupported) {
        setPushLoading(true);
        try {
          const result = await subscribeToPushNotifications(user.id);
          if (!result.success) {
            console.warn("Push subscription failed:", result.error);
          }
        } catch (err) {
          console.warn("Push subscription error:", err);
        }
        setPushLoading(false);
      }

      // If user opted in for biometrics, register passkey
      if (biometricsEnabled && biometricsAvailable) {
        setBiometricsLoading(true);
        try {
          const result = await registerPasskey();
          if (result.success) {
            toast({
              title: "Biometrics enabled!",
              description: "You can now sign in with Face ID / Touch ID.",
            });
          } else {
            console.warn("Passkey registration failed:", result.error);
            toast({
              title: "Biometrics setup skipped",
              description: "You can enable it later in your profile settings.",
            });
          }
        } catch (err) {
          console.warn("Passkey registration error:", err);
        }
        setBiometricsLoading(false);
      }

      // CRITICAL: Clear the invite flow context now that profile is complete
      // This ensures the progress dots never appear again for this user
      clearInviteFlowContext();
      localStorage.removeItem("pwa_pending_invite");

      toast({
        title: "Profile completed!",
        description: "Welcome to Ignite Club HQ!",
      });
      
      // Check if there's a pending redirect (e.g., from invite link)
      const redirectPath = sessionStorage.getItem("redirectAfterAuth");
      // Clean up stored invite label
      sessionStorage.removeItem("inviteLabel");
      sessionStorage.removeItem("autoJoinAfterAuth");
      sessionStorage.removeItem("authDefaultTab");
      
      if (redirectPath) {
        // Only remove redirectAfterAuth since we're using it now
        sessionStorage.removeItem("redirectAfterAuth");
        navigate(redirectPath, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
      
      // Refresh profile in background
      refreshProfile();
    } catch (err) {
      console.error("Profile update failed:", err);
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  const isInInviteFlow = inviteFlowContext?.active === true;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Show progress indicator if in invite flow */}
      {isInInviteFlow && (
        <InviteFlowProgress 
          currentStep="profile" 
          isIOS={inviteFlowContext?.isIOS}
          isExistingUser={false}
          className="fixed top-0 left-0 right-0"
        />
      )}
      
      <div className={`flex-1 flex flex-col items-center justify-center p-4 ${isInInviteFlow ? 'pt-16' : ''}`}>
      <div className="w-full max-w-md space-y-8 animate-slide-up">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="p-4 rounded-2xl bg-primary glow-emerald">
            <Flame className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-gradient-emerald">Complete Your Profile</h1>
          <p className="text-muted-foreground text-center">
            Add your details to get started
          </p>
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Profile Setup</CardTitle>
            <CardDescription>
              We need a few details before you can access the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar Upload */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className="h-24 w-24 border-4 border-primary/20">
                  <AvatarImage src={avatarUrl || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary">
                    <User className="h-10 w-10" />
                  </AvatarFallback>
                </Avatar>
                <label className="absolute bottom-0 right-0 p-2 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors">
                  <Camera className="h-4 w-4 text-primary-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                    disabled={uploading}
                  />
                </label>
              </div>
              {uploading && <p className="text-sm text-muted-foreground">Uploading...</p>}
            </div>

            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="Enter your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
              />
            </div>

            {/* Pending Invites Section */}
            {!invitesLoading && pendingInvites.length > 0 && (
              <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <UserPlus className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-sm">
                        {pendingInvites.length === 1 ? "Pending Invitation" : `${pendingInvites.length} Pending Invitations`}
                      </p>
                      <p className="text-xs text-muted-foreground">Accept invites to join organizations</p>
                    </div>
                  </div>
                  <Switch
                    checked={acceptInvites}
                    onCheckedChange={setAcceptInvites}
                  />
                </div>
                
                {/* List the invites */}
                <div className="space-y-2 pt-2 border-t border-border/50">
                  {pendingInvites.map((invite) => (
                    <div key={invite.id} className="flex items-center gap-2 text-sm">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-muted-foreground">
                        {invite.team_name || invite.club_name || "Organization"}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {invite.role.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
                
                {!acceptInvites && (
                  <p className="text-xs text-destructive">
                    You can use the invite link later to join.
                  </p>
                )}
              </div>
            )}

            {/* Push Notifications Toggle */}
            {pushSupported && (
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Enable Push Notifications</p>
                    <p className="text-xs text-muted-foreground">Get notified about events, messages & more</p>
                  </div>
                </div>
                <Switch
                  checked={pushEnabled}
                  onCheckedChange={setPushEnabled}
                  disabled={pushLoading}
                />
              </div>
            )}

            {/* Install App Button - shown when browser supports PWA install or on iOS */}
            {!isInstalled && (canPrompt || isIOS) && (
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Install App</p>
                    <p className="text-xs text-muted-foreground">
                      {isIOS ? "Tap Share → Add to Home Screen for best experience" : "Add to home screen for the best experience"}
                    </p>
                  </div>
                </div>
                {!isIOS && (
                  <Switch
                    checked={installAndContinue}
                    onCheckedChange={setInstallAndContinue}
                  />
                )}
              </div>
            )}

            {/* Biometrics Toggle */}
            {biometricsAvailable && (
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Fingerprint className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Enable Biometric Login</p>
                    <p className="text-xs text-muted-foreground">Sign in with Face ID or Touch ID</p>
                  </div>
                </div>
                <Switch
                  checked={biometricsEnabled}
                  onCheckedChange={setBiometricsEnabled}
                  disabled={biometricsLoading}
                />
              </div>
            )}

            {/* Show "Open App" message after successful install */}
            {showOpenAppMessage ? (
              <div className="space-y-4 text-center p-4 rounded-lg border bg-primary/10 border-primary/20">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-primary/20">
                    <Download className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-lg">App Installed! 🎉</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your profile has been saved. Now open Ignite Club HQ from your home screen to continue.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Look for the Ignite icon on your home screen
                </p>
              </div>
            ) : (
              <Button
                className="w-full" 
                onClick={async () => {
                  // If user wants to install, save profile first then trigger install
                  if (installAndContinue && canPrompt) {
                    setSaving(true);
                    try {
                      // Save profile first
                      const { error } = await supabase
                        .from("profiles")
                        .update({
                          display_name: displayName.trim(),
                          avatar_url: avatarUrl || null,
                        })
                        .eq("id", user.id);

                      if (error) {
                        toast({
                          title: "Error",
                          description: "Failed to save profile. Please try again.",
                          variant: "destructive",
                        });
                        setSaving(false);
                        return;
                      }

                      // Handle push notifications if enabled
                      if (pushEnabled && pushSupported) {
                        try {
                          await subscribeToPushNotifications(user.id);
                        } catch (err) {
                          console.warn("Push subscription error:", err);
                        }
                      }

                      // Handle biometrics if enabled
                      if (biometricsEnabled && biometricsAvailable) {
                        try {
                          await registerPasskey();
                        } catch (err) {
                          console.warn("Passkey registration error:", err);
                        }
                      }

                      setSaving(false);

                      // Now trigger install
                      const installed = await installApp();
                      if (installed) {
                        // Show message to open the installed app
                        setShowOpenAppMessage(true);
                        toast({
                          title: "App installed!",
                          description: "Open Ignite Club HQ from your home screen.",
                        });
                        return;
                      } else {
                        // User dismissed install - navigate to redirect or home
                        const redirectPath = sessionStorage.getItem("redirectAfterAuth");
                        if (redirectPath) {
                          sessionStorage.removeItem("redirectAfterAuth");
                          navigate(redirectPath, { replace: true });
                        } else {
                          navigate("/", { replace: true });
                        }
                        refreshProfile();
                        return;
                      }
                    } catch (err) {
                      console.error("Error during install flow:", err);
                      setSaving(false);
                    }
                  }
                  // Normal flow - just save profile
                  handleSubmit();
                }}
                disabled={saving || !displayName.trim()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (installAndContinue && canPrompt ? "Install & Continue" : "Continue to Ignite Club HQ")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
