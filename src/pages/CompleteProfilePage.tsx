import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Flame, User, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function CompleteProfilePage() {
  const { user, profile, loading: authLoading, profileLoading, profileError, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Initialize form values once profile is loaded
  useEffect(() => {
    if (!authLoading && !profileLoading && profile && !initialized) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
      setInitialized(true);
    }
  }, [authLoading, profileLoading, profile, initialized]);

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

            <Button 
              className="w-full" 
              onClick={handleSubmit}
              disabled={saving || !displayName.trim()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue to Ignite Club HQ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
