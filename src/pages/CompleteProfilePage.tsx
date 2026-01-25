import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Flame, User, Camera, Loader2, Bell, Download, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToPushNotifications, checkPushSubscription } from "@/lib/pushNotifications";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { usePasskey, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";

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
  const { toast } = useToast();
  const navigate = useNavigate();
  const { canPrompt, isInstalled, installApp, isReady: pwaReady, isIOS } = usePWAInstall();
  const { registerPasskey } = usePasskey();

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

  // Initialize form values once loading is complete, with pending invite prefill
  useEffect(() => {
    const initializeProfile = async () => {
      if (authLoading || profileLoading || initialized) return;
      
      // Initialize with existing profile data if available
      let prefillName = profile?.display_name || "";
      const prefillAvatar = profile?.avatar_url || "";
      
      // If no display name, check for pending invite with invited_label
      if (!prefillName && user) {
        // First try pending_invites table (for team invites with invited_label)
        const { data: pendingInvite } = await supabase
          .from("pending_invites")
          .select("invited_label")
          .eq("status", "pending")
          .not("invited_label", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (pendingInvite?.invited_label) {
          prefillName = pendingInvite.invited_label;
        }
        
        // If still no name, check if there's a stored invite label from club/team join pages
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
  }, [authLoading, profileLoading, profile, user, initialized]);

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

      // After profile is created, check for pending invites and assign roles
      // Match by email since invited_user_id may not be set correctly for new users
      const userEmail = user.email?.toLowerCase();
      console.log("[CompleteProfile] Checking for pending invites for email:", userEmail);
      
      let pendingInvites: any[] = [];
      
      if (userEmail) {
        // First try matching by email
        const { data: emailInvites, error: emailError } = await supabase
          .from("pending_invites")
          .select("id, team_id, club_id, role, invited_user_id, invited_email")
          .eq("invited_email", userEmail)
          .eq("status", "pending");
        
        if (emailError) {
          console.error("[CompleteProfile] Error fetching invites by email:", emailError);
        } else if (emailInvites && emailInvites.length > 0) {
          pendingInvites = emailInvites;
          console.log("[CompleteProfile] Found invites by email:", emailInvites.length);
        }
      }
      
      // Also check by user ID (in case invited_user_id was set correctly)
      if (pendingInvites.length === 0) {
        const { data: userIdInvites } = await supabase
          .from("pending_invites")
          .select("id, team_id, club_id, role, invited_user_id, invited_email")
          .eq("invited_user_id", user.id)
          .eq("status", "pending");
        
        if (userIdInvites && userIdInvites.length > 0) {
          pendingInvites = userIdInvites;
          console.log("[CompleteProfile] Found invites by user ID:", userIdInvites.length);
        }
      }

      if (pendingInvites.length > 0) {
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
            .eq("role", invite.role);
          
          if (invite.team_id) {
            roleQuery.eq("team_id", invite.team_id);
          } else if (clubId) {
            roleQuery.eq("club_id", clubId);
          }
          
          const { data: existingRole } = await roleQuery.maybeSingle();

          if (!existingRole) {
            // Insert the role
            const { error: roleError } = await supabase
              .from("user_roles")
              .insert({
                user_id: user.id,
                role: invite.role,
                team_id: invite.team_id || null,
                club_id: clubId || null,
              });

            if (roleError) {
              console.error("[CompleteProfile] Failed to assign role from invite:", roleError);
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
      } else {
        console.log("[CompleteProfile] No pending invites found for user");
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

      toast({
        title: "Profile completed!",
        description: "Welcome to Ignite Club HQ!",
      });
      
      // Check if there's a pending redirect (e.g., from invite link)
      const redirectPath = sessionStorage.getItem("redirectAfterAuth");
      // Clean up stored invite label
      sessionStorage.removeItem("inviteLabel");
      
      if (redirectPath) {
        // Keep autoJoinAfterAuth flag - it will be consumed by the join page
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
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
  );
}
