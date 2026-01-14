import { useSyncStatus, SyncStatus } from "@/hooks/useSyncStatus";
import { Cloud, CloudOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SyncStatusIndicator() {
  const { status, lastSyncTime } = useSyncStatus();

  const getStatusConfig = (status: SyncStatus) => {
    switch (status) {
      case "syncing":
        return {
          icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
          label: "Syncing...",
          color: "text-blue-500",
        };
      case "synced":
        return {
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          label: "Synced to server",
          color: "text-green-500",
        };
      case "error":
        return {
          icon: <AlertCircle className="h-3.5 w-3.5" />,
          label: "Sync failed",
          color: "text-destructive",
        };
      default:
        return {
          icon: <CloudOff className="h-3.5 w-3.5" />,
          label: "Not syncing",
          color: "text-muted-foreground",
        };
    }
  };

  const config = getStatusConfig(status);
  const timeAgo = lastSyncTime ? Math.floor((Date.now() - lastSyncTime) / 1000) : null;

  // Only show when actively syncing or has an error - hide the green tick when synced
  if (status === "idle" || status === "synced") return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-xs",
            config.color
          )}>
            {config.icon}
            <span className="hidden sm:inline">{status === "syncing" ? "Syncing" : "Error"}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Background notifications enabled
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
