import { useState, useEffect } from "react";
import { Bell, Loader2, Send, CheckCircle, XCircle, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface NativePushCardProps {
  userId: string;
}

export function NativePushCard({ userId }: NativePushCardProps) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [testPushDelay, setTestPushDelay] = useState(10);

  // Check if native push is already enabled
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // Check if user has FCM tokens in the database
        const { data, error } = await supabase
          .from('fcm_tokens' as any)
          .select('id')
          .eq('user_id', userId)
          .limit(1);
        
        if (!error && data && data.length > 0) {
          setPushEnabled(true);
        }
        
        // Also check native permission status
        const { checkNativePermission } = await import("@/lib/nativePush");
        const permission = await checkNativePermission();
        setPushEnabled(permission === 'granted' && (!error && data && data.length > 0));
      } catch (err) {
        console.error('[NativePushCard] Error checking status:', err);
      } finally {
        setLoading(false);
      }
    };
    
    checkStatus();
  }, [userId]);

  const handleEnablePush = async () => {
    setEnabling(true);
    
    try {
      const { initializeNativePush } = await import("@/lib/nativePush");
      const result = await initializeNativePush(userId);
      
      if (result.success) {
        setPushEnabled(true);
        toast.success("Push notifications enabled!", {
          description: "You'll now receive notifications on this device."
        });
      } else {
        toast.error("Failed to enable notifications", {
          description: result.error || "Please check your device settings."
        });
      }
    } catch (err) {
      console.error('[NativePushCard] Error enabling push:', err);
      toast.error("Error enabling notifications");
    } finally {
      setEnabling(false);
    }
  };

  const handleDisablePush = async () => {
    setEnabling(true);
    
    try {
      const { unregisterNativePush } = await import("@/lib/nativePush");
      await unregisterNativePush(userId);
      setPushEnabled(false);
      toast.success("Push notifications disabled");
    } catch (err) {
      console.error('[NativePushCard] Error disabling push:', err);
      toast.error("Error disabling notifications");
    } finally {
      setEnabling(false);
    }
  };

  const handleTestPush = async () => {
    setTestingPush(true);
    toast.info(`Test notification scheduled`, {
      description: `Notification will arrive in ${testPushDelay} seconds. Lock your phone now!`
    });
    
    try {
      const { data, error } = await supabase.functions.invoke('test-push-notification', {
        body: { delay: testPushDelay }
      });
      
      if (error) {
        console.error('Test push error:', error);
        toast.error("Test failed", {
          description: error.message || "Could not send test notification"
        });
      } else {
        console.log('Test push result:', data);
        toast.success("Test sent!", {
          description: "If push is working, you should receive a notification."
        });
      }
    } catch (err) {
      console.error('Test push exception:', err);
      toast.error("Test failed", {
        description: err instanceof Error ? err.message : "Unknown error"
      });
    }
    setTestingPush(false);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Receive notifications on this device
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {pushEnabled ? (
              <CheckCircle className="h-5 w-5 text-emerald-500" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <Label>Push Notifications</Label>
              <p className="text-xs text-muted-foreground">
                {pushEnabled 
                  ? "Notifications are enabled on this device" 
                  : "Enable to receive alerts and updates"}
              </p>
            </div>
          </div>
          <Switch
            checked={pushEnabled}
            onCheckedChange={(checked) => {
              if (checked) {
                handleEnablePush();
              } else {
                handleDisablePush();
              }
            }}
            disabled={enabling}
          />
        </div>

        {/* Enable button for first-time setup */}
        {!pushEnabled && (
          <Button
            className="w-full"
            onClick={handleEnablePush}
            disabled={enabling}
          >
            {enabling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Enabling...
              </>
            ) : (
              <>
                <Bell className="h-4 w-4 mr-2" />
                Enable Push Notifications
              </>
            )}
          </Button>
        )}

        {/* Test Push Button */}
        {pushEnabled && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="push-delay" className="text-sm whitespace-nowrap">Delay:</Label>
              <select
                id="push-delay"
                value={testPushDelay}
                onChange={(e) => setTestPushDelay(Number(e.target.value))}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                disabled={testingPush}
              >
                <option value={5}>5 sec</option>
                <option value={10}>10 sec</option>
                <option value={15}>15 sec</option>
                <option value={30}>30 sec</option>
                <option value={60}>60 sec</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestPush}
                disabled={testingPush}
                className="flex-1"
              >
                {testingPush ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {testingPush ? `Sending in ${testPushDelay}s...` : 'Test Push'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tap the button, then lock your phone. Notification arrives after the delay.
            </p>
          </div>
        )}

        {/* Native app indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          <Smartphone className="h-4 w-4" />
          <span>Using native push notifications via Firebase Cloud Messaging</span>
        </div>
      </CardContent>
    </Card>
  );
}
