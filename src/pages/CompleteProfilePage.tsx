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
  const { toast } = useToast();
  const navigate = useNavigate();
  const { canPrompt, isInstalled, installApp } = usePWAInstall();
  const { registerPasskey } = usePasskey();

  // Check if push notifications and biometrics are supported
  useEffect(() => {
    if (typeof window === 'undefined' || 
        !('PushManager' in window) || 
        !('serviceWorker' in navigator) ||
        !('Notification' in window)) {
      setPushSupported(false);
    }
    
    // Check biometrics availability
    isPlatformAuthenticatorAvailable().then(available => {
      setBiometricsAvailable(available);
    });
  }, []);

  // Initialize form values once profile is loaded, with pending invite prefill
  useEffect(() => {
    const initializeProfile = async () => {
      if (authLoading || profileLoading || initialized) return;
      
      if (profile) {
        let prefillName = profile.display_name || "";
        
        // If no display name, check for pending invite with invited_label
        if (!prefillName && user) {
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
        }
        
        setDisplayName(prefillName);
        setAvatarUrl(profile.avatar_url || "");
        setInitialized(true);
      }
    };
    
    initializeProfile();
  }, [authLoading, profileLoading, profile, user, initialized]);

  // Show loading while auth or profile is loading
  if (authLoading || profileLoading) {
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

  // If there was an error loading profile OR profile is null, redirect to home
  // AppLayout will handle showing retry screen or proper routing
  if (profileError || !profile) {
    return <Navigate to="/" replace />;
  }

  // Redirect to home if profile already has display_name
  if (profile.display_name) {
    return <Navigate to="/" replace />;
  }

  // Only show form if profile exists AND has no display_name

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
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim(),
          avatar_url: avatarUrl || null,
        })
        .eq("id", user.id);

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
      
      // Navigate immediately after successful update - don't wait for state
      navigate("/", { replace: true });
      
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

            {/* Install App Button - shown when browser supports PWA install */}
            {canPrompt && !isInstalled && (
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Install App</p>
                    <p className="text-xs text-muted-foreground">Add to home screen for the best experience</p>
                  </div>
                </div>
                <Switch
                  checked={installAndContinue}
                  onCheckedChange={setInstallAndContinue}
                />
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

            <Button
              className="w-full" 
              onClick={async () => {
                // If user wants to install, trigger install first
                if (installAndContinue && canPrompt) {
                  const installed = await installApp();
                  if (installed) {
                    // After PWA is installed, it will open fresh - save profile and let PWA handle navigation
                    await handleSubmit();
                    return;
                  }
                }
                // Normal flow - just save profile
                handleSubmit();
              }}
              disabled={saving || !displayName.trim()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (installAndContinue && canPrompt ? "Install & Continue" : "Continue to Ignite Club HQ")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
