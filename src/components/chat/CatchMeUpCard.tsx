import { Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CatchMeUpCardProps {
  unreadCount: number;
  /** Optional teaser line shown beneath the title. */
  teaser?: string | null;
  loading?: boolean;
  onView: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Compact AI "Catch me up" card shown above unread messages when the user
 * returns to a thread with a lot of activity. Kept intentionally lightweight
 * so it doesn't dominate the message screen.
 */
export function CatchMeUpCard({
  unreadCount,
  teaser,
  loading = false,
  onView,
  onDismiss,
  className,
}: CatchMeUpCardProps) {
  return (
    <div
      className={cn(
        "mx-3 my-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5 shadow-sm",
        className,
      )}
      data-testid="catch-me-up-card"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold leading-tight">
              Catch up on {unreadCount} unread message{unreadCount === 1 ? "" : "s"}
            </p>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="ml-auto -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground"
                aria-label="Dismiss summary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {loading
              ? "Generating a quick summary…"
              : teaser ?? "Get a quick AI summary of the key updates while you were away."}
          </p>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={onView}
              disabled={loading}
            >
              View summary
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
