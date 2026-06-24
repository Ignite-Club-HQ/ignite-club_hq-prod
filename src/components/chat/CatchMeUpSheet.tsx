import { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, AlertCircle, CheckCircle2, CalendarClock, Users,
  Paperclip, HelpCircle, RefreshCw, Info,
} from "lucide-react";
import type { ChatSummaryPayload, ChatSummaryResult } from "@/hooks/useChatCatchUp";

interface CatchMeUpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  result: ChatSummaryResult | null;
  unreadCount: number;
  onRegenerate: () => void;
  onUpgrade?: () => void;
}

const SECTIONS: Array<{
  key: keyof ChatSummaryPayload;
  label: string;
  icon: ReactNode;
  emptyHidden?: boolean;
}> = [
  { key: "important_updates", label: "Important updates", icon: <Info className="h-4 w-4 text-primary" /> },
  { key: "actions_needed", label: "Actions needed", icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
  { key: "schedule_changes", label: "Schedule changes", icon: <CalendarClock className="h-4 w-4 text-amber-500" /> },
  { key: "people_mentioned", label: "People mentioned", icon: <Users className="h-4 w-4 text-blue-500" /> },
  { key: "files_shared", label: "Files / photos shared", icon: <Paperclip className="h-4 w-4 text-violet-500" /> },
  { key: "unanswered_questions", label: "Questions still unanswered", icon: <HelpCircle className="h-4 w-4 text-rose-500" /> },
];

function errorMessage(code: string | null): { title: string; body: string; isPro?: boolean } {
  switch (code) {
    case "pro_required":
      return {
        title: "Pro feature",
        body: "AI ‘Catch me up’ summaries are available on Pro clubs. Upgrade to unlock instant catch-up for your members.",
        isPro: true,
      };
    case "rate_limited":
      return {
        title: "Slow down",
        body: "Too many summary requests just now. Please try again in a minute.",
      };
    case "credits_exhausted":
      return {
        title: "AI temporarily unavailable",
        body: "Our AI provider has run out of credits. Please try again later.",
      };
    case "no_messages":
      return {
        title: "Nothing to summarise",
        body: "There aren’t any recent messages in this chat yet.",
      };
    default:
      return {
        title: "Couldn’t generate summary",
        body: "Something went wrong while preparing your summary. Please try again.",
      };
  }
}

export function CatchMeUpSheet({
  open, onOpenChange, loading, error, result, unreadCount, onRegenerate, onUpgrade,
}: CatchMeUpSheetProps) {
  const err = error ? errorMessage(error) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl px-0 pb-0">
        <SheetHeader className="px-4 pt-1 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </span>
            Catch me up
            {unreadCount > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {unreadCount} unread
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pt-2 pb-6">
          {loading && !result && (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-9/12" />
              </div>
              <p className="pt-3 text-xs text-muted-foreground">Reading the last messages and pulling out what matters…</p>
            </div>
          )}

          {!loading && err && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold">{err.title}</p>
              </div>
              <p className="text-sm text-muted-foreground">{err.body}</p>
              <div className="mt-3 flex gap-2">
                {err.isPro && onUpgrade && (
                  <Button size="sm" onClick={onUpgrade}>Upgrade to Pro</Button>
                )}
                {!err.isPro && (
                  <Button size="sm" variant="secondary" onClick={onRegenerate}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && !err && result && (
            <>
              {result.summary.headline && (
                <p className="mb-3 text-sm font-medium leading-snug text-foreground">
                  {result.summary.headline}
                </p>
              )}

              <div className="divide-y divide-border/60 rounded-xl border border-border bg-card">
                {SECTIONS.map((section) => {
                  const items = result.summary[section.key] as string[];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={section.key} className="px-3 py-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        {section.icon}
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.label}
                        </p>
                      </div>
                      <ul className="space-y-1 pl-1">
                        {items.map((item, i) => (
                          <li key={i} className="flex gap-2 text-sm leading-snug">
                            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                            <span className="text-foreground">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                {SECTIONS.every((s) => {
                  const items = result.summary[s.key] as string[];
                  return !items || items.length === 0;
                }) && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Nothing actionable in the recent messages — looks like casual chat.
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Summarised from the last {result.message_count} message{result.message_count === 1 ? "" : "s"}.
                </p>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onRegenerate}>
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
              </div>
            </>
          )}

          <p className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            AI summaries can make mistakes. Check key details before acting.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
