import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings, Lock, Unlock, Loader2, Camera, Play, Zap } from "lucide-react";
import { useChatVirtualizationFlag } from "@/hooks/useChatVirtualizationFlag";
import { setChatVirtualizationEnabled } from "@/lib/featureFlags/chatVirtualization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/ui/page-loading";

export default function AppSettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check if user is app admin
  const { data: isAppAdmin, isLoading: isLoadingAuth } = useQuery({
    queryKey: ["isAppAdmin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch app settings
  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user && isAppAdmin === true,
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const { error } = await supabase
        .from("app_settings")
        .update({ value: value })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] });
      toast({ title: "Setting updated" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to update setting", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const runPhotoPromptMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("post-game-photo-prompts", {
        body: {},
      });
      if (error) throw error;
      return data as { ok?: boolean; scanned?: number; posted?: number; skipped?: number; errors?: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Photo prompt run complete",
        description: `Scanned ${data?.scanned ?? 0} · Posted ${data?.posted ?? 0} · Skipped ${data?.skipped ?? 0} · Errors ${data?.errors ?? 0}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to run photo prompt",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getSetting = (key: string): boolean => {
    const setting = settings?.find(s => s.key === key);
    return setting?.value === true || setting?.value === "true";
  };

  const handleToggle = (key: string, currentValue: boolean) => {
    updateSettingMutation.mutate({ key, value: !currentValue });
  };

  if (isLoadingAuth || isLoadingSettings) {
    return <PageLoading />;
  }

  if (!isAppAdmin) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">App Settings</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-muted-foreground">Access denied. App admin role required.</p>
        </div>
      </div>
    );
  }

  const isClubCreationLocked = getSetting("club_creation_locked");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">App Settings</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isClubCreationLocked ? (
                <Lock className="h-5 w-5 text-amber-500" />
              ) : (
                <Unlock className="h-5 w-5 text-green-500" />
              )}
              Club Creation
            </CardTitle>
            <CardDescription>
              Control whether users can create new clubs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="club-creation-lock" className="text-base font-medium">
                  Lock club creation
                </Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, only app admins can create new clubs. Use this during pilot programs or to control growth.
                </p>
              </div>
              <Switch
                id="club-creation-lock"
                checked={isClubCreationLocked}
                onCheckedChange={() => handleToggle("club_creation_locked", isClubCreationLocked)}
                disabled={updateSettingMutation.isPending}
              />
            </div>
            {updateSettingMutation.isPending && (
              <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Updating...
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              Post-game photo prompts
            </CardTitle>
            <CardDescription>
              Manually run the hourly cron that posts "Got photos?" cards to team chats for games that ended 2–3 hours ago. Useful for testing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => runPhotoPromptMutation.mutate()}
              disabled={runPhotoPromptMutation.isPending}
              className="gap-2"
            >
              {runPhotoPromptMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run photo prompt now
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground pt-4">
          <p>Current status: {isClubCreationLocked ? "Only app admins can create clubs" : "Anyone can create clubs"}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-device toggle for the virtualised chat list. Stored in localStorage
 * via `setChatVirtualizationEnabled` so each admin can dogfood without a
 * deploy. Off by default; the legacy mapped list remains the safe fallback.
 */
function ChatVirtualizationCard() {
  const enabled = useChatVirtualizationFlag();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Virtualised chat list (beta)
        </CardTitle>
        <CardDescription>
          Renders only the chat messages near your viewport. Smoother on long threads,
          but still being verified — toggle off if you notice anything off. Setting is
          per-device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="chat-virtualization" className="text-base font-medium">
              Enable on this device
            </Label>
            <p className="text-sm text-muted-foreground">
              Restart any open chat after toggling.
            </p>
          </div>
          <Switch
            id="chat-virtualization"
            checked={enabled}
            onCheckedChange={(checked) => setChatVirtualizationEnabled(checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
