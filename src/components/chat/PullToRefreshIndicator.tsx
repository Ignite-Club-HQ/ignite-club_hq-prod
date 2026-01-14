import { Loader2, ArrowDown } from "lucide-react";

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  pullProgress: number;
  isRefreshing: boolean;
  threshold?: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  pullProgress,
  isRefreshing,
  threshold = 80,
}: PullToRefreshIndicatorProps) {
  const isTriggered = pullProgress >= 1 || isRefreshing;

  // Show centered overlay spinner when refreshing
  if (isRefreshing) {
    return (
      <>
        {/* Top indicator */}
        <div
          className="flex items-center justify-center overflow-hidden transition-all duration-200"
          style={{ height: 40 }}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Refreshing...</span>
          </div>
        </div>
        
        {/* Centered overlay spinner */}
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-card shadow-lg border">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground font-medium">Loading messages...</span>
          </div>
        </div>
      </>
    );
  }

  if (pullDistance === 0) return null;

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-all duration-200"
      style={{
        height: pullDistance,
        opacity: Math.min(pullProgress * 1.5, 1),
      }}
    >
      <div
        className={`flex items-center gap-2 text-muted-foreground transition-transform duration-200 ${
          isTriggered ? "scale-100" : "scale-90"
        }`}
      >
        <ArrowDown
          className={`h-4 w-4 transition-transform duration-200 ${
            isTriggered ? "rotate-180" : ""
          }`}
        />
        <span className="text-xs">
          {isTriggered ? "Release to refresh" : "Pull to refresh"}
        </span>
      </div>
    </div>
  );
}