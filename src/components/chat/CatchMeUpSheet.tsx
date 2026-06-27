import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, AlertCircle, CheckCircle2, CalendarClock,
  Paperclip, HelpCircle, RefreshCw, MessageSquare, ChevronDown, ChevronUp, Pin,
  Loader2, X,
} from "lucide-react";
import type { ChatSummaryResult, OutstandingAction, OutstandingQuestion } from "@/hooks/useChatCatchUp";
import { normalizeQuestion } from "@/hooks/useChatCatchUp";
import { parseRecapTimeTag, stripRecapDatePrefix, isVagueRecapBullet } from "@/lib/recapFormat";

/**
 * On native Android WebView, running 20–40 concurrent setInterval-driven
 * typewriter animations (one per Typed/Reveal in the summary) while large
 * edge-function payloads land has crashed the WebView to a white screen.
 * We short-circuit the animation path on native and when the user prefers
 * reduced motion — content renders immediately, no per-character timers.
 */
function useStaticReveal(): boolean {
  const [staticMode, setStaticMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (Capacitor.isNativePlatform()) return true;
    try {
      return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (Capacitor.isNativePlatform()) { setStaticMode(true); return; }
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = () => setStaticMode(mq.matches);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    } catch { /* ignore */ }
  }, []);
  return staticMode;
}


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
  onLookback?: (hours: number) => void;
  onUpgrade?: () => void;
}

const LOOKBACK_OPTIONS: { label: string; hours: number }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

function cleanHeadline(text: string | null | undefined): string {
  const cleaned = stripRecapDatePrefix(text ?? "").trim();
  return /nothing actionable|casual chat/i.test(cleaned) ? "" : cleaned;
}

function formatLookbackLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "last 24 hours" : `last ${days} days`;
  }
  return `last ${hours} hours`;
}

function formatSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

interface RecapTimelineItem { time: string | null; text: string }

function errorMessage(code: string | null): { title: string; body: string; isPro?: boolean; isSensitive?: boolean } {
  switch (code) {
    case "pro_required":
      return {
        title: "Pro feature",
        body: "AI ‘Chat Recap’ summaries are available on Pro clubs. Upgrade to unlock instant recap for your members.",
        isPro: true,
      };
    case "feature_disabled":
      return { title: "Turned off for this club", body: "An admin has disabled AI ‘Chat Recap’ for this club. Ask a club admin to re-enable it in club settings." };
    case "disclosure_required":
      return { title: "One-time acknowledgement needed", body: "Please accept the AI privacy notice to use Chat Recap." };
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
  open, onOpenChange, loading, error, result, unreadCount, onRegenerate, onLookback, onUpgrade,
}: CatchMeUpSheetProps) {
  const err = error ? errorMessage(error) : null;
  const [showDetailed, setShowDetailed] = useState(false);
  const staticMode = useStaticReveal();
  const loadingStage = useLoadingStage(loading && !result);

  // Normalise to new schema (handle legacy cached summaries from previous version).
  const view = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    const clean = (arr?: string[] | null) => (arr ?? []).map(stripRecapDatePrefix).filter((t) => !isVagueRecapBullet(t));
    const since = {
      today: clean(s.since_last_visit?.today),
      yesterday: clean(s.since_last_visit?.yesterday),
      earlier: clean(s.since_last_visit?.earlier),
    };
    const sinceTimeline: RecapTimelineItem[] = [];
    const seenSince = new Set<string>();
    const pushSince = (arr?: string[] | null) => {
      for (const raw of arr ?? []) {
        const parsed = parseRecapTimeTag(raw);
        const text = parsed.text || stripRecapDatePrefix(raw);
        if (!text || seenSince.has(text)) continue;
        if (isVagueRecapBullet(text)) continue;
        seenSince.add(text);
        sinceTimeline.push({ time: parsed.time, text });
      }
    };
    pushSince(s.since_last_visit?.today);
    pushSince(s.since_last_visit?.yesterday);
    pushSince(s.since_last_visit?.earlier);
    if (!s.since_last_visit) {
      since.today = (s.important_updates?.slice(0, 3) ?? []).map(stripRecapDatePrefix).filter((t) => !isVagueRecapBullet(t));
    }
    const actions: OutstandingAction[] = (s.outstanding_actions
      ?? (s.actions_needed ?? []).map((t) => ({ text: t, owner: null, priority: "medium" as const })))
      .map((a) => ({ ...a, text: stripRecapDatePrefix(a.text) }))
      .filter((a) => !isVagueRecapBullet(a.text));
    const questions: OutstandingQuestion[] = (s.outstanding_questions ?? s.unanswered_questions ?? []).map(normalizeQuestion);
    const detailedRaw = s.detailed ?? {
      schedule_changes: s.schedule_changes ?? [],
      files_shared: s.files_shared ?? [],
      discussion: s.important_updates ?? [],
    };
    const detailed = {
      schedule_changes: clean(detailedRaw.schedule_changes),
      files_shared: clean(detailedRaw.files_shared),
      discussion: clean(detailedRaw.discussion),
    };
    const detailedHasAny =
      detailed.schedule_changes.length + detailed.files_shared.length + detailed.discussion.length > 0;

    // Fallback: when the model didn't return a since_last_visit timeline but
    // we DO have detailed bullets, synthesize the activity feed from those so
    // users always see a narrative timeline rather than just Outstanding actions.
    if (sinceTimeline.length === 0 && detailedHasAny) {
      const pushDetailed = (arr: string[]) => {
        for (const raw of arr) {
          const parsed = parseRecapTimeTag(raw);
          const text = parsed.text || stripRecapDatePrefix(raw);
          if (!text || seenSince.has(text)) continue;
          if (isVagueRecapBullet(text)) continue;
          seenSince.add(text);
          sinceTimeline.push({ time: parsed.time, text });
        }
      };
      pushDetailed(detailed.schedule_changes);
      pushDetailed(detailed.discussion);
      pushDetailed(detailed.files_shared);
    }

    const sinceHasAny = sinceTimeline.length > 0 || since.today.length + since.yesterday.length + since.earlier.length > 0;
    const anythingAtAll = sinceHasAny || actions.length > 0 || questions.length > 0 || detailedHasAny;
    return { headline: cleanHeadline(s.headline), since, sinceTimeline, actions, questions, detailed, detailedHasAny, sinceHasAny, anythingAtAll };
  }, [result]);

  // Auto-expand the detailed summary when there is no top-level activity feed
  // to show, otherwise users only see Outstanding actions with no narrative.
  useEffect(() => {
    if (view && view.detailedHasAny && !view.sinceHasAny) {
      setShowDetailed(true);
    }
  }, [view?.detailedHasAny, view?.sinceHasAny]);

  // Sequential top-to-bottom typing: each line waits for all previous lines to
  // finish typing before it starts. We compute the cumulative delay per line
  // from the running character total + a small gap between lines.
  // In staticMode (native / reduced motion) we collapse all delays to 0 so
  // every Typed/Reveal renders instantly — no per-character setInterval storm.
  const CHAR_MS = staticMode ? 0 : 16;
  const GAP_MS = staticMode ? 0 : 120;
  const HEADER_REVEAL_MS = staticMode ? 0 : 220;
  const delayRef = useRef(0);
  delayRef.current = 0;
  const scheduleType = (text: string) => {
    if (staticMode) return 0;
    const start = delayRef.current;
    delayRef.current = start + text.length * CHAR_MS + GAP_MS;
    return start;
  };
  const scheduleReveal = (ms: number = HEADER_REVEAL_MS) => {
    if (staticMode) return 0;
    const start = delayRef.current;
    delayRef.current = start + ms;
    return start;
  };



  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[85vh] flex flex-col rounded-t-2xl px-0 pb-0">
        <SheetHeader className="relative px-4 pt-1 text-left">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
          <SheetTitle className="flex items-center gap-2.5 text-2xl font-semibold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </span>
            Chat Recap
            {unreadCount > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {unreadCount} unread
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pt-2 pb-6 overflow-y-auto flex-1 min-h-0">
          {loading && !result && (
            <LoadingTypewriter stage={loadingStage} staticMode={staticMode} />
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
                <p className="mb-3 text-base font-normal leading-relaxed text-foreground">
                  <Typed text={view.headline} delayMs={scheduleType(view.headline)} charMs={CHAR_MS} />
                </p>
              )}

              {/* Recent activity / Since your last visit — timeline-style activity feed */}
              {view.sinceHasAny && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <Reveal delayMs={scheduleReveal()} className="mb-3 flex items-center gap-2">
                    <Pin className="h-4 w-4 text-primary" />
                    <p className="text-base font-semibold text-muted-foreground">
                      {(result?.used_fallback || unreadCount === 0) && !result?.lookback_hours ? "Recent activity" : "Since your last visit"}
                    </p>
                  </Reveal>
                  <div className="space-y-4">
                    {(() => {
                      const stripTime = (t?: string | null) => {
                        if (!t) return "";
                        // Remove trailing time like " 8:43am", " 10:17pm", " 9am"
                        return t.replace(/\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*$/i, "").trim();
                      };
                      const groups: { date: string; items: typeof view.sinceTimeline }[] = [];
                      for (const item of view.sinceTimeline) {
                        const date = stripTime(item.time) || "";
                        const last = groups[groups.length - 1];
                        if (last && last.date === date) last.items.push(item);
                        else groups.push({ date, items: [item] });
                      }
                      return groups.map((g, gi) => (
                        <div key={`${g.date}-${gi}`}>
                          {g.date && (
                            <Reveal delayMs={scheduleReveal(80)} as="div" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {g.date}
                            </Reveal>
                          )}
                          <ul className="space-y-3">
                            {g.items.map((item) => {
                              const delay = scheduleType(item.text);
                              return (
                                <li key={`${item.time ?? "item"}-${item.text}`} className="text-base leading-relaxed text-foreground">
                                  <Typed text={item.text} delayMs={delay} charMs={CHAR_MS} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ));
                    })()}
                  </div>
                </section>
              )}

              {/* Outstanding actions */}
              {view.actions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <Reveal delayMs={scheduleReveal()} className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-base font-semibold text-muted-foreground">
                      {view.actions.length === 1 ? "Outstanding action" : "Outstanding actions"}
                    </p>
                  </Reveal>
                  <ul className="space-y-4">
                    {view.actions.map((a, i) => {
                      const badgeDelay = scheduleReveal(80);
                      const textDelay = scheduleType(a.text);
                      const ownerDelay = a.owner ? scheduleReveal(120) : 0;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <Reveal delayMs={badgeDelay} as="span" className={`mt-[0.15em] w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${priorityBadgeClasses(a.priority)}`}>
                            {a.priority === "high" ? "High" : a.priority === "low" ? "Low" : "Medium"}
                          </Reveal>
                          <div className="min-w-0 flex-1">
                            <span className="text-base font-medium leading-relaxed text-foreground">
                              <Typed text={a.text} delayMs={textDelay} charMs={CHAR_MS} />
                            </span>
                            {a.owner && (
                              <Reveal delayMs={ownerDelay} className="mt-1 text-sm font-normal text-muted-foreground">
                                Owner • {a.owner}
                              </Reveal>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Outstanding questions removed — folded into activity for richer detail */}

              {!view.anythingAtAll && (
                <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
                  <Typed text="No useful team updates were found in the recent messages." delayMs={scheduleType("No useful team updates were found in the recent messages.")} charMs={CHAR_MS} />
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
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const n = result!.message_count;
                    const msg = `${n} message${n === 1 ? "" : "s"}`;
                    if (result!.lookback_hours) {
                      const base = `Summarised ${msg} from the ${formatLookbackLabel(result!.lookback_hours)}`;
                      return result!.truncated
                        ? `${base}. Showing the most recent ${n} — older messages in this window were trimmed for length.`
                        : `${base}.`;
                    }
                    if (result!.used_fallback) {
                      return `Summarised ${msg} from the last 7 days.`;
                    }

                    const since = formatSinceLabel(result!.window_since);
                    // If the user has nothing unread, "since your last visit" is misleading —
                    // their read state was updated elsewhere (push, another device, mark-as-read).
                    if (unreadCount === 0) {
                      return since
                        ? `Summarised ${msg} of recent activity (${since}).`
                        : `Summarised ${msg} of recent activity.`;
                    }
                    return since
                      ? `Summarised ${n} new message${n === 1 ? "" : "s"} since your last visit (${since}).`
                      : `Summarised ${n} new message${n === 1 ? "" : "s"} since your last visit.`;
                  })()}
                </p>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onRegenerate}>
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
              </div>

              {onLookback && (
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <p className="text-xs font-medium text-foreground">Look further back</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Summarise a longer time window of this chat.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {LOOKBACK_OPTIONS.map((opt) => {
                      const active = result!.lookback_hours === opt.hours;
                      return (
                        <Button
                          key={opt.hours}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-7 text-xs"
                          disabled={loading || active}
                          onClick={() => onLookback(opt.hours)}
                        >
                          {opt.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <p className="mt-4 text-xs text-muted-foreground/70">
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
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-base font-semibold text-muted-foreground">{label}</p>
      </div>
      {items.length === 1 ? (
        <p className="text-base leading-relaxed text-foreground">{items[0]}</p>
      ) : (
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="text-base leading-relaxed text-foreground">
            {item}
          </div>
        ))}
      </div>
      )}
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
  // staticMode is signalled by charMs === 0 (set by useStaticReveal): render
  // the full text immediately, no setInterval/setTimeout, no per-character
  // re-render storm. This is the Android-WebView crash mitigation.
  const isStatic = charMs <= 0;
  const [n, setN] = useState(isStatic ? text.length : 0);
  const [started, setStarted] = useState(isStatic || delayMs === 0);
  useEffect(() => {
    if (isStatic) { setN(text.length); setStarted(true); return; }
    setN(0);
    setStarted(delayMs === 0);
    if (delayMs === 0) return;
    const t = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(t);
  }, [text, delayMs, isStatic]);
  useEffect(() => {
    if (isStatic || !started) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, charMs);
    return () => clearInterval(id);
  }, [started, text, charMs, isStatic]);

  // Grid stack: invisible full text reserves space; visible partial overlays it.
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1" aria-hidden>{text}</span>
      <span className="col-start-1 row-start-1">{text.slice(0, n)}</span>
    </span>
  );
}

/**
 * Fades children in after `delayMs`. Reserves layout space upfront (renders
 * invisibly) so the sheet height stays stable while siblings reveal.
 */
function Reveal({
  delayMs = 0,
  as: As = "div",
  className,
  children,
}: {
  delayMs?: number;
  as?: "div" | "span" | "p";
  className?: string;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(delayMs === 0);
  useEffect(() => {
    setShown(delayMs === 0);
    if (delayMs === 0) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    <As
      className={className}
      style={{ opacity: shown ? 1 : 0, transition: "opacity 180ms ease-out" }}
    >
      {children}
    </As>
  );
}



/**
 * Typewriter shown while we wait for the summary to land. Starts typing
 * immediately on mount (no skeleton wait), then types each subsequent stage
 * line as `stage` advances. Gives the perception that work has already begun.
 */
function LoadingTypewriter({ stage, staticMode = false }: { stage: number; staticMode?: boolean }) {
  // Lines to type so far: every stage up to and including the current one.
  const lines = LOADING_STAGES.slice(0, Math.max(1, stage + 1));
  const isFinalStage = stage >= LOADING_STAGES.length - 1;
  const [showReassurance, setShowReassurance] = useState(false);

  useEffect(() => {
    if (!isFinalStage) { setShowReassurance(false); return; }
    const t = setTimeout(() => setShowReassurance(true), 2500);
    return () => clearTimeout(t);
  }, [isFinalStage, stage]);

  return (
    <div className="space-y-2 py-1">
      {lines.map((line, i) => (
        <TypewriterLine
          key={i}
          text={line}
          showCaret={!staticMode && i === lines.length - 1}
          staticMode={staticMode}
        />
      ))}
      {showReassurance && (
        <div className="flex items-center gap-2 pt-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Almost there… this usually takes a few seconds.
          </p>
        </div>
      )}
    </div>
  );
}

function TypewriterLine({ text, showCaret, staticMode = false }: { text: string; showCaret: boolean; staticMode?: boolean }) {
  const [shown, setShown] = useState(staticMode ? text.length : 0);
  useEffect(() => {
    if (staticMode) { setShown(text.length); return; }
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [text, staticMode]);
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
