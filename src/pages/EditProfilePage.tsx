import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Loader2, User, Camera, Bell, MessageSquare, Calendar, Image, Users, Download, Smartphone, LayoutGrid, Send, Settings, FileText, Shield, Trash2, DatabaseBackup, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { updateProfileCache } from "@/lib/profileCache";
import { 
  subscribeToPushNotifications, 
  unsubscribeFromPushNotifications, 
  checkPushSubscription,
  resetPushNotifications,
  wasJustReset
} from "@/lib/pushNotifications";
import { usePWAInstall } from "@/hooks/usePWAInstall";


interface NotificationPreferences {
  messages_enabled: boolean;
  events_enabled: boolean;
  media_enabled: boolean;
  membership_enabled: boolean;
  pitch_board_enabled: boolean;
}

export default function EditProfilePage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();
  const { setTheme, theme } = useTheme();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);
  const [pushSupported, setPushSupported] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    messages_enabled: true,
    events_enabled: true,
    media_enabled: true,
    membership_enabled: true,
    pitch_board_enabled: true,
  });
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [resettingPush, setResettingPush] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  
  // Detect if on mobile browser
  const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [profile]);

  // Load notification preferences
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user) return;
      
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();
      
      if (data) {
        setPreferences({
          messages_enabled: data.messages_enabled,
          events_enabled: data.events_enabled,
          media_enabled: data.media_enabled,
          membership_enabled: data.membership_enabled,
          pitch_board_enabled: data.pitch_board_enabled ?? true,
        });
      }
    };
    
    loadPreferences();
  }, [user]);

  // Check push notification status
  useEffect(() => {
    const checkPushStatus = async () => {
      // Guard against SSR and missing APIs
      if (typeof window === 'undefined' || 
          !('PushManager' in window) || 
          !('serviceWorker' in navigator) ||
          !('Notification' in window)) {
        setPushSupported(false);
        setPushLoading(false);
        return;
      }
      
      // Check if we just reset - show a toast
      if (wasJustReset()) {
        toast({
          title: "Push notifications reset",
          description: "Wait a few seconds, then enable notifications again",
        });
      }
      
      // Pass user ID to also verify subscription exists in database
      const isSubscribed = await checkPushSubscription(user?.id);
      setPushEnabled(isSubscribed);
      setPushLoading(false);
    };
    
    checkPushStatus();
  }, [toast, user?.id]);

  const handlePushToggle = async (enabled: boolean) => {
    console.log('[EditProfile] Push toggle clicked, enabled:', enabled, 'user:', !!user, 'pushLoading:', pushLoading);
    
    if (!user) {
      toast({
        title: "Not logged in",
        description: "Please log in to enable push notifications",
        variant: "destructive",
      });
      return;
    }
    
    setPushLoading(true);
    
    try {
      if (enabled) {
        console.log('[EditProfile] Calling subscribeToPushNotifications...');
        toast({ title: "Enabling push notifications...", description: "Please allow notifications if prompted" });
        const result = await subscribeToPushNotifications(user.id);
        console.log('[EditProfile] Subscribe result:', result);
        
        if (result.success) {
          setPushEnabled(true);
          toast({ title: "Push notifications enabled" });
        } else {
          const errorMsg = result.error || "Please check your browser permissions";
          console.error('[EditProfile] Push subscription failed:', errorMsg);
          toast({ 
            title: "Push Error", 
            description: errorMsg,
            variant: "destructive",
            duration: 15000
          });
        }
      } else {
        console.log('[EditProfile] Calling unsubscribeToPushNotifications...');
        await unsubscribeFromPushNotifications(user.id);
        setPushEnabled(false);
        toast({ title: "Push notifications disabled" });
      }
    } catch (error) {
      console.error('[EditProfile] Push toggle error:', error);
      toast({ 
        title: "Error updating notification settings", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    }
    
    setPushLoading(false);
  };

  const handlePreferenceChange = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!user) return;
    
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);
    setPrefsLoading(true);
    
    try {
      // Upsert preferences
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({
          user_id: user.id,
          ...newPrefs,
        }, { onConflict: "user_id" });
      
      if (error) throw error;
    } catch (error) {
      // Revert on error
      setPreferences(preferences);
      toast({
        title: "Failed to update preference",
        variant: "destructive",
      });
    }
    
    setPrefsLoading(false);
  };

  const handleTestPush = async () => {
    if (!user) return;
    
    setTestingPush(true);
    toast({
      title: "Test notification scheduled",
      description: "Notification will arrive in 5 seconds. Close the app now!",
    });
    
    try {
      const { data, error } = await supabase.functions.invoke('test-push-notification', {
        body: { delay: 5 }
      });
      
      if (error) {
        console.error('Test push error:', error);
        toast({
          title: "Test failed",
          description: error.message || "Could not send test notification",
          variant: "destructive",
        });
      } else {
        console.log('Test push result:', data);
        toast({
          title: "Test sent!",
          description: "If push is working, you should have received a notification",
        });
      }
    } catch (err) {
      console.error('Test push exception:', err);
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
    setTestingPush(false);
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke('delete-account', {
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
      });
      
      if (response.error) {
        toast({
          title: "Failed to schedule account deletion",
          description: response.error.message,
          variant: "destructive",
        });
        setDeletingAccount(false);
        return;
      }
      
      const deletionDate = new Date(response.data.deletionDate);
      toast({
        title: "Account scheduled for deletion",
        description: `Your account will be permanently deleted on ${deletionDate.toLocaleDateString()}. Log back in within 30 days to recover it.`,
      });
      
      await signOut();
      navigate("/auth");
    } catch (err) {
      toast({
        title: "Failed to schedule account deletion",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      setDeletingAccount(false);
    }
  };

  const handleExportData = async () => {
    setExportingData(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      
      // Call edge function directly to get binary ZIP response
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-user-data`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionData.session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Export failed');
      }
      
      // Get the ZIP blob directly from response
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ignite-data-export-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Data exported",
        description: "Your data has been downloaded as a ZIP file with CSV files inside.",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
    setExportingData(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image under 2MB",
        variant: "destructive",
      });
      return;
    }

    setUploadingAvatar(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const storagePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Store the storage URL format (will be converted to signed URL when displayed)
      const supabaseUrl = "https://yabcfiuntwqjwvschnji.supabase.co";
      const storageUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${storagePath}`;

      setAvatarUrl(storageUrl);
      toast({ title: "Photo uploaded!" });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not upload photo",
        variant: "destructive",
      });
    }

    setUploadingAvatar(false);
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      toast({
        title: "Display name required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        avatar_url: avatarUrl.trim() || null,
      })
      .eq("id", user!.id);

    setSaving(false);

    if (error) {
      toast({
        title: "Failed to update profile",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    // Update profile cache for other components that reference this user
    updateProfileCache({
      id: user!.id,
      display_name: displayName.trim(),
      avatar_url: avatarUrl.trim() || null,
    });

    await refreshProfile();
    toast({ title: "Profile updated!" });
    navigate("/profile");
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Edit Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Preview */}
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24 border-4 border-primary/20">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-3xl">
                {displayName.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name *</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              maxLength={50}
            />
          </div>

          {/* Avatar Upload */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Profile Photo
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                id="avatar-upload"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('avatar-upload')?.click()}
                disabled={uploadingAvatar}
                className="flex-1"
              >
                {uploadingAvatar ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    {avatarUrl ? "Change Photo" : "Upload Photo"}
                  </>
                )}
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setAvatarUrl("")}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Max 2MB. JPG, PNG, or GIF.
            </p>
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving || !displayName.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Appearance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            Appearance
          </CardTitle>
          <CardDescription>
            Choose your preferred theme
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === "dark" ? (
                <Moon className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Sun className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">Dark Mode</span>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Push Notifications Card */}
      {pushSupported && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Push Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Master Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-notifications">Enable Push Notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Receive notifications on your device
                </p>
              </div>
              <Switch
                id="push-notifications"
                checked={pushEnabled}
                onCheckedChange={handlePushToggle}
                disabled={pushLoading}
              />
            </div>

            {/* Test Push Button */}
            {pushEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestPush}
                disabled={testingPush}
                className="w-full"
              >
                {testingPush ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send Test Notification
              </Button>
            )}

            {/* Reset Push Button - for troubleshooting */}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setResettingPush(true);
                toast({ title: "Resetting notifications...", description: "Page will reload to fully clear browser state" });
                // Use reloadAfter=true to fully clear browser push state
                await resetPushNotifications(user?.id, true);
                // The page will reload, so no need to handle the result
              }}
              disabled={resettingPush || pushLoading}
              className="w-full text-muted-foreground"
            >
              {resettingPush ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Reset Notifications (Troubleshoot)
            </Button>

            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Browser permission:</span>
              <span className={
                Notification.permission === 'granted' 
                  ? 'text-emerald-500 font-medium' 
                  : Notification.permission === 'denied'
                  ? 'text-destructive font-medium'
                  : 'text-muted-foreground'
              }>
                {Notification.permission === 'granted' ? 'Allowed' : 
                 Notification.permission === 'denied' ? 'Blocked' : 'Not set'}
              </span>
            </div>
            {Notification.permission === 'denied' && (
              <div className="text-xs text-destructive/80 bg-destructive/10 p-3 rounded-md space-y-2">
                <p className="font-medium">Notifications are blocked by your browser</p>
                <div className="space-y-1">
                  <p className="font-medium">To unblock:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Click the <strong>lock/tune icon</strong> in the address bar</li>
                    <li>Find <strong>"Notifications"</strong></li>
                    <li>Change from "Block" to <strong>"Allow"</strong></li>
                    <li>Reload the page</li>
                  </ol>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => window.location.reload()}
                >
                  Refresh after unblocking
                </Button>
              </div>
            )}

            {/* PWA Install Prompt for Mobile Web Users */}
            {isMobileBrowser && !isInstalled && (
              <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  <p className="font-medium text-sm">Install for Better Notifications</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  For reliable background notifications, install this app to your home screen. 
                  This ensures notifications work even when you're not actively using the app.
                </p>
                {canPrompt ? (
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="w-full"
                    onClick={installApp}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Install App
                  </Button>
                ) : isIOS ? (
                  <div className="text-xs space-y-2 bg-background/50 p-3 rounded-md">
                    <p className="font-medium">To install on iPhone/iPad:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Tap the <strong>Share</strong> button (square with arrow)</li>
                      <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                      <li>Tap <strong>"Add"</strong> to confirm</li>
                    </ol>
                  </div>
                ) : (
                  <div className="text-xs space-y-2 bg-background/50 p-3 rounded-md">
                    <p className="font-medium">To install on Android:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Tap the <strong>menu</strong> (three dots) in your browser</li>
                      <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong></li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {isMobileBrowser && isInstalled && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-3 rounded-md">
                <Download className="h-4 w-4" />
                <span>App installed - background notifications are enabled</span>
              </div>
            )}

            {/* Category Preferences */}
            {pushEnabled && (
              <div className="space-y-4 pt-4 border-t">
                <p className="text-sm font-medium">Notification Categories</p>
                <p className="text-xs text-muted-foreground">
                  Choose which types of notifications you want to receive
                </p>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="pref-messages">Messages</Label>
                        <p className="text-xs text-muted-foreground">
                          Team, club, group chats & broadcasts
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="pref-messages"
                      checked={preferences.messages_enabled}
                      onCheckedChange={(v) => handlePreferenceChange("messages_enabled", v)}
                      disabled={prefsLoading}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="pref-events">Events</Label>
                        <p className="text-xs text-muted-foreground">
                          Invites, cancellations & duty assignments
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="pref-events"
                      checked={preferences.events_enabled}
                      onCheckedChange={(v) => handlePreferenceChange("events_enabled", v)}
                      disabled={prefsLoading}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="pref-media">Media</Label>
                        <p className="text-xs text-muted-foreground">
                          Photo uploads, reactions & comments
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="pref-media"
                      checked={preferences.media_enabled}
                      onCheckedChange={(v) => handlePreferenceChange("media_enabled", v)}
                      disabled={prefsLoading}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="pref-membership">Membership</Label>
                        <p className="text-xs text-muted-foreground">
                          Join requests & approvals
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="pref-membership"
                      checked={preferences.membership_enabled}
                      onCheckedChange={(v) => handlePreferenceChange("membership_enabled", v)}
                      disabled={prefsLoading}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="pref-pitch-board">Pitch Board</Label>
                        <p className="text-xs text-muted-foreground">
                          Substitution alerts & game updates
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="pref-pitch-board"
                      checked={preferences.pitch_board_enabled}
                      onCheckedChange={(v) => handlePreferenceChange("pitch_board_enabled", v)}
                      disabled={prefsLoading}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Legal Links Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Legal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link 
            to="/privacy" 
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
          >
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Privacy Policy</p>
              <p className="text-xs text-muted-foreground">How we handle your data</p>
            </div>
          </Link>
          <Link 
            to="/terms" 
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
          >
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Terms of Service</p>
              <p className="text-xs text-muted-foreground">Usage terms and conditions</p>
            </div>
          </Link>
        </CardContent>
      </Card>

      {/* Export Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            Export Your Data
          </CardTitle>
          <CardDescription>
            Download a copy of all your personal data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Export includes your profile, roles, RSVPs, uploaded photos, comments, feedback, and more.
          </p>
          <Button 
            variant="outline" 
            onClick={handleExportData}
            disabled={exportingData}
          >
            {exportingData ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download My Data
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Delete Account Card */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Account
          </CardTitle>
          <CardDescription>
            Schedule your account for deletion with a 30-day recovery period
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>When you delete your account:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Your account will be scheduled for deletion in 30 days</li>
              <li>You can recover your account by logging back in within this period</li>
              <li>After 30 days, all your data will be permanently removed</li>
            </ul>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deletingAccount}>
                {deletingAccount ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete My Account
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Schedule account deletion?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Your account will be scheduled for permanent deletion in 30 days.
                  </p>
                  <p>
                    During this period, you can recover your account by simply logging back in.
                    After 30 days, all your data will be permanently removed including your profile, 
                    messages, and any roles you hold in clubs and teams.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, schedule deletion
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}