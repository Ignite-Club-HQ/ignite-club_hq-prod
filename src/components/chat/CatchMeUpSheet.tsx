import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, AlertCircle, CheckCircle2, CalendarClock,
  Paperclip, HelpCircle, RefreshCw, MessageSquare, ChevronDown, ChevronUp, Pin,
} from "lucide-react";
import type { ChatSummaryResult, OutstandingAction } from "@/hooks/useChatCatchUp";

const LOADING_STAGES = [
  "Reading recent messages…",
  "Sorting by when they arrived…",
  "Pulling out actions & questions…",
  "Polishing the summary…",
];

function useLoadingStage(active: boolean) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active) { setStage(0); return; }
    const id = setInterval(() => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)), 1800);
    return () => clearInterval(id);
  }, [active]);
  return stage;
}

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

function errorMessage(code: string | null): { title: string; body: string; isPro?: boolean; isSensitive?: boolean } {
  switch (code) {
    case "pro_required":
      return {
        title: "Pro feature",
        body: "AI ‘Catch me up’ summaries are available on Pro clubs. Upgrade to unlock instant catch-up for your members.",
        isPro: true,
      };
    case "feature_disabled":
      return { title: "Turned off for this club", body: "An admin has disabled AI ‘Catch me up’ for this club. Ask a club admin to re-enable it in club settings." };
    case "disclosure_required":
      return { title: "One-time acknowledgement needed", body: "Please accept the AI privacy notice to use Catch me up." };
    case "rate_limited":
      return { title: "Slow down", body: "Too many summary requests just now. Please try again in a minute." };
    case "credits_exhausted":
      return { title: "AI temporarily unavailable", body: "Our AI provider has run out of credits. Please try again later." };
    case "no_messages":
      return { title: "Nothing to summarise", body: "There aren’t any recent messages in this chat yet." };
    case "fetch_failed":
      return { title: "Couldn’t read messages", body: "We couldn’t load the recent messages for this chat. Check your connection and try again." };
    case "ai_not_configured":
      return { title: "AI not configured", body: "The AI provider isn’t set up yet. Ask an app admin to add the required API key." };
    case "ai_failed":
      return { title: "AI service unreachable", body: "We couldn’t reach the AI service. This usually clears up in a minute — please try again." };
    case "ai_timeout":
      return { title: "AI took too long", body: "The on-chain AI model timed out on this thread (long threads can exceed its window). Tap Regenerate to retry, or ask an app admin to switch the AI provider to Gemini in App Settings for faster results." };
    case "ai_invalid_output":
      return { title: "AI returned an unreadable summary", body: "The AI didn’t return valid output for this thread (often happens on very long or sparse chats). Try Regenerate, or ask an app admin to switch the AI provider in App Settings." };
    case "sensitive_content":
      return {
        title: "Summary blocked",
        body: "This thread contains sensitive content (medical, safeguarding or disciplinary). For privacy we don’t send these messages to AI — please read them directly.",
        isSensitive: true,
      };
    case "server_error":
      return { title: "Something went wrong", body: "An unexpected error occurred while preparing your summary. Please try again." };
    default:
      return { title: "Couldn’t generate summary", body: "Something went wrong while preparing your summary. Please try again, or switch providers in App Settings if it keeps happening." };
  }
}

function priorityBadgeClasses(p: OutstandingAction["priority"]) {
  switch (p) {
    case "high":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "low":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  }
}

export function CatchMeUpSheet({
  open, onOpenChange, loading, error, result, unreadCount, onRegenerate, onUpgrade,
}: CatchMeUpSheetProps) {
  const err = error ? errorMessage(error) : null;
  const [showDetailed, setShowDetailed] = useState(false);
  const loadingStage = useLoadingStage(loading && !result);

  // Normalise to new schema (handle legacy cached summaries from previous version).
  const view = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    const since = s.since_last_visit ?? {
      today: s.important_updates?.slice(0, 3) ?? [],
      yesterday: [] as string[],
      earlier: [] as string[],
    };
    const actions: OutstandingAction[] = s.outstanding_actions
      ?? (s.actions_needed ?? []).map((t) => ({ text: t, owner: null, priority: "medium" as const }));
    const questions = s.outstanding_questions ?? s.unanswered_questions ?? [];
    const detailed = s.detailed ?? {
      schedule_changes: s.schedule_changes ?? [],
      files_shared: s.files_shared ?? [],
      discussion: s.important_updates ?? [],
    };
    const detailedHasAny =
      detailed.schedule_changes.length + detailed.files_shared.length + detailed.discussion.length > 0;
    const sinceHasAny = since.today.length + since.yesterday.length + since.earlier.length > 0;
    const anythingAtAll = sinceHasAny || actions.length > 0 || questions.length > 0 || detailedHasAny;
    return { headline: s.headline, since, actions, questions, detailed, detailedHasAny, sinceHasAny, anythingAtAll };
  }, [result]);

  // Sequential top-to-bottom typing: each line waits for all previous lines to
  // finish typing before it starts. We compute the cumulative delay per line
  // from the running character total + a small gap between lines.
  const CHAR_MS = 16;
  const GAP_MS = 120;
  const delayRef = useRef(0);
  delayRef.current = 0;
  const scheduleType = (text: string) => {
    const start = delayRef.current;
    delayRef.current = start + text.length * CHAR_MS + GAP_MS;
    return start;
  };



  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] flex flex-col rounded-t-2xl px-0 pb-0">
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

        <div className="px-4 pt-2 pb-6 overflow-y-auto flex-1 min-h-0">
          {loading && !result && (
            <LoadingTypewriter stage={loadingStage} />
          )}

          {!loading && err && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold">{err.title}</p>
              </div>
              <p className="text-sm text-muted-foreground">{err.body}</p>
              <div className="mt-3 flex gap-2">
                {err.isPro && onUpgrade && <Button size="sm" onClick={onUpgrade}>Upgrade to Pro</Button>}
                {!err.isPro && !err.isSensitive && (
                  <Button size="sm" variant="secondary" onClick={onRegenerate}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && !err && view && (
            <>
              {view.headline && (
                <p className="mb-3 text-sm font-medium leading-snug text-foreground">
                  <Typed text={view.headline} delayMs={scheduleType(view.headline)} charMs={CHAR_MS} />
                </p>
              )}

              {/* Since your last visit */}
              {view.sinceHasAny && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Pin className="h-4 w-4 text-primary" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Since your last visit
                    </p>
                  </div>
                  {(["today", "yesterday", "earlier"] as const).map((bucket) => {
                    const items = view.since[bucket];
                    if (!items || items.length === 0) return null;
                    const label = bucket === "today" ? "Today" : bucket === "yesterday" ? "Yesterday" : "Earlier this week";
                    return (
                      <div key={bucket} className="mb-2 last:mb-0">
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                          {label}
                        </p>
                        <ul className="space-y-1 pl-1">
                          {items.map((item, i) => (
                            <li key={i} className="flex gap-2 text-sm leading-snug">
                              <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                              <span className="text-foreground">
                                <Typed text={item} delayMs={scheduleType(item)} charMs={CHAR_MS} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Outstanding actions */}
              {view.actions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Outstanding actions
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {view.actions.map((a, i) => (
                      <li key={i} className="flex flex-col gap-1">
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${priorityBadgeClasses(a.priority)}`}>
                            {a.priority}
                          </span>
                          <span className="text-sm leading-snug text-foreground">
                            <Typed text={a.text} delayMs={scheduleType(a.text)} charMs={CHAR_MS} />
                          </span>
                        </div>
                        {a.owner && (
                          <span className="pl-[52px] text-[11px] text-muted-foreground">Owner: {a.owner}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Outstanding questions */}
              {view.questions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-rose-500" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Outstanding questions
                    </p>
                  </div>
                  <ul className="space-y-1 pl-1">
                    {view.questions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-sm leading-snug">
                        <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        <span className="text-foreground">
                          <Typed text={q} delayMs={scheduleType(q)} charMs={CHAR_MS} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!view.anythingAtAll && (
                <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
                  <Typed text="Nothing actionable in the recent messages — looks like casual chat." delayMs={scheduleType("Nothing actionable in the recent messages — looks like casual chat.")} charMs={CHAR_MS} />
                </div>
              )}
            </>
          )}


          {!loading && !err && view && (
            <>


              {/* Detailed (collapsed) */}
              {view.detailedHasAny && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowDetailed((v) => !v)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/60"
                  >
                    <span>{showDetailed ? "Hide detailed summary" : "View detailed summary"}</span>
                    {showDetailed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showDetailed && (
                    <div className="mt-1 divide-y divide-border/60 rounded-xl border border-border bg-card">
                      {view.detailed.schedule_changes.length > 0 && (
                        <DetailBlock
                          icon={<CalendarClock className="h-4 w-4 text-amber-500" />}
                          label="Schedule changes"
                          items={view.detailed.schedule_changes}
                        />
                      )}
                      {view.detailed.files_shared.length > 0 && (
                        <DetailBlock
                          icon={<Paperclip className="h-4 w-4 text-violet-500" />}
                          label="Files & photos shared"
                          items={view.detailed.files_shared}
                        />
                      )}
                      {view.detailed.discussion.length > 0 && (
                        <DetailBlock
                          icon={<MessageSquare className="h-4 w-4 text-blue-500" />}
                          label="Other discussion"
                          items={view.detailed.discussion}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Summarised from the last {result!.message_count} message{result!.message_count === 1 ? "" : "s"}.
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

function DetailBlock({ icon, label, items }: { icon: React.ReactNode; label: string; items: string[] }) {
  return (
    <div className="px-3 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
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
}

/**
 * Streams `text` one character at a time after an optional `delayMs`, used to
 * give the summary a ChatGPT-style top-down typing reveal. Reserves the full
 * line height via an invisible underlay so the sheet doesn't shift as it types.
 */
function Typed({
  text,
  delayMs = 0,
  charMs = 16,
}: {
  text: string;
  delayMs?: number;
  charMs?: number;
}) {
  const [n, setN] = useState(0);
  const [started, setStarted] = useState(delayMs === 0);
  useEffect(() => {
    setN(0);
    setStarted(delayMs === 0);
    if (delayMs === 0) return;
    const t = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(t);
  }, [text, delayMs]);
  useEffect(() => {
    if (!started) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, charMs);
    return () => clearInterval(id);
  }, [started, text, charMs]);
  // Grid stack: invisible full text reserves space; visible partial overlays it.
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1" aria-hidden>{text}</span>
      <span className="col-start-1 row-start-1">{text.slice(0, n)}</span>
    </span>
  );
}


/**
 * Typewriter shown while we wait for the summary to land. Starts typing
 * immediately on mount (no skeleton wait), then types each subsequent stage
 * line as `stage` advances. Gives the perception that work has already begun.
 */
function LoadingTypewriter({ stage }: { stage: number }) {
  // Lines to type so far: every stage up to and including the current one.
  const lines = LOADING_STAGES.slice(0, Math.max(1, stage + 1));
  return (
    <div className="space-y-2 py-1">
      {lines.map((line, i) => (
        <TypewriterLine
          key={i}
          text={line}
          // Only the last (newest) line shows the blinking caret while it types.
          showCaret={i === lines.length - 1}
        />
      ))}
    </div>
  );
}

function TypewriterLine({ text, showCaret }: { text: string; showCaret: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [text]);
  const done = shown >= text.length;
  return (
    <p className="text-sm leading-snug text-foreground">
      {text.slice(0, shown)}
      {showCaret && (
        <span
          className={`ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-primary ${done ? "animate-pulse" : ""}`}
          aria-hidden
        />
      )}
    </p>
  );
}
