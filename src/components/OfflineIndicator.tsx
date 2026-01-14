import { WifiOff, CloudOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getQueueCount, syncQueuedMessages } from "@/lib/messageQueue";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

export function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Update queue count periodically
  useEffect(() => {
    const updateCount = () => setQueueCount(getQueueCount());
    updateCount();
    
    const interval = setInterval(updateCount, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (wasOffline && isOnline && queueCount > 0) {
      handleSync();
    }
  }, [wasOffline, isOnline, queueCount]);

  const handleSync = useCallback(async () => {
    if (isSyncing || !isOnline) return;
    
    setIsSyncing(true);
    try {
      const { synced, failed } = await syncQueuedMessages();
      setQueueCount(getQueueCount());
      
      if (synced > 0) {
        toast.success(`Synced ${synced} message${synced > 1 ? "s" : ""}`);
      }
      if (failed > 0) {
        toast.error(`Failed to sync ${failed} message${failed > 1 ? "s" : ""}`);
      }
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error("Failed to sync messages");
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing]);

  // Don't show if online and no queued messages
  if (isOnline && queueCount === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
      <div 
        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg ${
          isOnline 
            ? "bg-amber-500/90 text-amber-50" 
            : "bg-destructive/90 text-destructive-foreground"
        }`}
      >
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span className="text-sm font-medium">
              Offline{queueCount > 0 ? ` • ${queueCount} pending` : ""}
            </span>
          </>
        ) : (
          <>
            <CloudOff className="h-4 w-4" />
            <span className="text-sm font-medium">{queueCount} pending</span>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="ml-1 p-1 rounded-full hover:bg-white/20 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
