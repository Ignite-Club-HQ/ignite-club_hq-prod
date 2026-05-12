import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings, Lock, Unlock, Loader2, Camera, Play, Zap, ZapOff, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const { error } = await supabase
        .from("app_settings")
        .update({ value: value as never })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] });
      // Also invalidate the targeted single-key cache used by hooks like
      // useChatVirtualizationEnabled so the kill-switch propagates immediately.
      queryClient.invalidateQueries({ queryKey: ["app-setting", vars.key] });
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
  // Default chat virtualisation to ON when the row is missing or unset.
  const chatVirtRow = settings?.find(s => s.key === "chat_virtualization_enabled");
  const isChatVirtEnabled = chatVirtRow?.value !== false && chatVirtRow?.value !== "false";

  // Basic-mode chunk size — clamped 10–500, default 100.
  const chunkRow = settings?.find(s => s.key === "chat_basic_chunk_size");
  const savedChunkSize = (() => {
    const raw = chunkRow?.value;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 100;
    return Math.min(500, Math.max(10, Math.floor(n)));
  })();
  const [chunkInput, setChunkInput] = useState<string>(String(savedChunkSize));
  useEffect(() => {
    setChunkInput(String(savedChunkSize));
  }, [savedChunkSize]);

  const handleSaveChunkSize = () => {
    const n = Math.min(500, Math.max(10, Math.floor(Number(chunkInput) || 0)));
    setChunkInput(String(n));
    if (n === savedChunkSize) return;
    updateSettingMutation.mutate({ key: "chat_basic_chunk_size", value: n });
  };


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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isChatVirtEnabled ? (
                <Zap className="h-5 w-5 text-green-500" />
              ) : (
                <ZapOff className="h-5 w-5 text-amber-500" />
              )}
              Chat virtualisation
            </CardTitle>
            <CardDescription>
              Emergency kill-switch. When OFF, every chat page renders as a basic mapped list (most recent 100 messages only) instead of the virtualised scroller. Use only if virtualisation is causing freezes — turn back on once resolved. May take up to 5 min to propagate to active sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="chat-virt-toggle" className="text-base font-medium">
                  Enable chat virtualisation
                </Label>
                <p className="text-sm text-muted-foreground">
                  {isChatVirtEnabled
                    ? "Normal mode: full message history with virtualised scrolling."
                    : "Fallback mode: basic scroller, last 100 messages only, no infinite scroll-up."}
                </p>
              </div>
              <Switch
                id="chat-virt-toggle"
                checked={isChatVirtEnabled}
                onCheckedChange={() => handleToggle("chat_virtualization_enabled", isChatVirtEnabled)}
                disabled={updateSettingMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5 text-primary" />
              Basic-mode chunk size
            </CardTitle>
            <CardDescription>
              When chat virtualisation is OFF, this controls how many messages basic mode renders initially and reveals each time someone taps "Load earlier messages". Lower = safer on low-end Android, higher = fewer taps to reach older history. Allowed: 10–500.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label htmlFor="chunk-size-input" className="text-base font-medium">
                  Messages per chunk
                </Label>
                <Input
                  id="chunk-size-input"
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={500}
                  step={10}
                  value={chunkInput}
                  onChange={(e) => setChunkInput(e.target.value)}
                  disabled={updateSettingMutation.isPending}
                />
              </div>
              <Button
                onClick={handleSaveChunkSize}
                disabled={
                  updateSettingMutation.isPending ||
                  String(savedChunkSize) === chunkInput.trim()
                }
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Currently saved: {savedChunkSize}
            </p>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground pt-4">
          <p>Current status: {isClubCreationLocked ? "Only app admins can create clubs" : "Anyone can create clubs"}</p>
        </div>
      </div>
    </div>
  );
}
