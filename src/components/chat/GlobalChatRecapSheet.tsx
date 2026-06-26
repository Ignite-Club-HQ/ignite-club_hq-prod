import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  CheckCircle2,
  HelpCircle,
  ChevronRight,
  X,
  AlertCircle,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getCatchUpLastOpened,
  type ChatScopeType,
  type ChatSummaryPayload,
  type ChatSummaryResult,
  type OutstandingAction,
} from "@/hooks/useChatCatchUp";

export interface RecapScopeRef {
  scope_type: ChatScopeType;
  scope_id: string;
  name: string;
  link: string;
  unreadCount: number;
  typeLabel?: string;
}

interface GlobalChatRecapSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Conversations with unread messages the recap should cover. */
  scopes: RecapScopeRef[];
}

interface PerScope {
  ref: RecapScopeRef;
  loading: boolean;
  error: string | null;
  result: ChatSummaryResult | null;
}

const CONCURRENCY = 4;

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

async function parseInvokeError(error: any): Promise<string> {
  let code = "unknown";
  try {
    const ctx: any = error?.context;
    const r: Response | undefined =
      ctx instanceof Response ? ctx : ctx?.response instanceof Response ? ctx.response : undefined;
    if (r) {
      const j = await r.clone().json().catch(() => null);
      if (j?.error) code = String(j.error);
    } else if (typeof ctx === "object" && ctx?.error) {
      code = String(ctx.error);
    }
  } catch { /* ignore */ }
  return code;
}

async function getLLMFnName(): Promise<string> {
  try {
    const { data: prov } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_summary_provider")
      .maybeSingle();
    const v = (prov as any)?.value;
    const provider = typeof v === "string" ? v : (v ? String(v) : "gemini");
    if (provider === "icp" || provider === '"icp"') return "summarize-chat-icp";
  } catch { /* default to gemini */ }
  return "summarize-chat";
}

async function fetchOne(ref: RecapScopeRef): Promise<{ result: ChatSummaryResult | null; error: string | null }> {
  // assemble-catchup supports team / club / group only; DMs + admin groups skipped.
  if (ref.scope_type !== "team" && ref.scope_type !== "club" && ref.scope_type !== "group") {
    return { result: null, error: "unsupported" };
  }
  const lastOpenedMs = getCatchUpLastOpened(ref.scope_type, ref.scope_id);
  const last_opened_at = lastOpenedMs ? new Date(lastOpenedMs).toISOString() : null;
  const body = { scope_type: ref.scope_type, scope_id: ref.scope_id, last_opened_at };
  try {
    const { data, error } = await supabase.functions.invoke("assemble-catchup", { body });
    if (!error && data) {
      return { result: data as ChatSummaryResult, error: null };
    }
    const code = error ? await parseInvokeError(error) : "unknown";
    // If digests aren't ready yet (worker hasn't covered this thread), fall back
    // to the full-LLM summariser — same behaviour as the per-thread hook.
    if (code === "digests_missing" || code === "unknown") {
      const fnName = await getLLMFnName();
      const { data: llmData, error: llmErr } = await supabase.functions.invoke(fnName, { body });
      if (llmErr) return { result: null, error: await parseInvokeError(llmErr) };
      return { result: llmData as ChatSummaryResult, error: null };
    }
    return { result: null, error: code };
  } catch (e: any) {
    return { result: null, error: e?.message || "unknown" };
  }
}

function normalise(summary: ChatSummaryPayload | undefined) {
  if (!summary) return { actions: [] as OutstandingAction[], questions: [] as string[], headline: "" };
  const actions: OutstandingAction[] =
    summary.outstanding_actions ??
    (summary.actions_needed ?? []).map((t) => ({ text: t, owner: null, priority: "medium" as const }));
  const questions = summary.outstanding_questions ?? summary.unanswered_questions ?? [];
  return { actions, questions, headline: summary.headline ?? "" };
}

export function GlobalChatRecapSheet({ open, onOpenChange, scopes }: GlobalChatRecapSheetProps) {
  const [perScope, setPerScope] = useState<PerScope[]>([]);
  const [runId, setRunId] = useState(0);

  // Kick off batched fetches whenever the sheet opens with a fresh set of scopes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const initial: PerScope[] = scopes.map((ref) => ({ ref, loading: true, error: null, result: null }));
    setPerScope(initial);

    (async () => {
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, scopes.length) }, async () => {
        while (!cancelled) {
          const idx = cursor++;
          if (idx >= scopes.length) return;
          const ref = scopes[idx];
          const { result, error } = await fetchOne(ref);
          if (cancelled) return;
          setPerScope((prev) => {
            const next = prev.slice();
            next[idx] = { ref, loading: false, result, error };
            return next;
          });
        }
      });
      await Promise.all(workers);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId]);

  const totalLoading = perScope.filter((p) => p.loading).length;
  const completed = perScope.length - totalLoading;

  const aggregated = useMemo(() => {
    const actions: Array<{ scope: RecapScopeRef; action: OutstandingAction }> = [];
    const questions: Array<{ scope: RecapScopeRef; text: string }> = [];
    for (const p of perScope) {
      if (!p.result) continue;
      const n = normalise(p.result.summary);
      n.actions.forEach((a) => actions.push({ scope: p.ref, action: a }));
      n.questions.forEach((q) => questions.push({ scope: p.ref, text: q }));
    }
    // High priority first, then medium, then low
    const rank = (p: OutstandingAction["priority"]) => (p === "high" ? 0 : p === "low" ? 2 : 1);
    actions.sort((a, b) => rank(a.action.priority) - rank(b.action.priority));
    return { actions, questions };
  }, [perScope]);

  const allEmpty =
    !totalLoading &&
    perScope.length > 0 &&
    perScope.every((p) => {
      const n = normalise(p.result?.summary);
      return n.actions.length === 0 && n.questions.length === 0 && !n.headline;
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[88vh] flex flex-col rounded-t-2xl px-0 pb-0">
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
            Recap all chats
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {scopes.length === 0
              ? "You're all caught up."
              : totalLoading > 0
                ? `Summarising ${completed} of ${scopes.length} unread thread${scopes.length === 1 ? "" : "s"}…`
                : `Summarised ${scopes.length} unread thread${scopes.length === 1 ? "" : "s"}.`}
          </p>
        </SheetHeader>

        <div className="px-4 pt-3 pb-6 overflow-y-auto flex-1 min-h-0">
          {scopes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/60 mb-3" />
              <p className="text-base font-medium text-foreground">No unread chats</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a thread directly and use Chat Recap inside it for a deeper summary.
              </p>
            </div>
          )}

          {scopes.length > 0 && (
            <>
              {/* Roll-up: outstanding actions across all threads */}
              {aggregated.actions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-base font-semibold text-muted-foreground">
                      Needs your attention
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {aggregated.actions.slice(0, 8).map(({ scope, action }, i) => (
                      <li key={`${scope.scope_id}-a-${i}`} className="flex items-start gap-3">
                        <span className={`mt-[0.15em] w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${priorityBadgeClasses(action.priority)}`}>
                          {action.priority === "high" ? "High" : action.priority === "low" ? "Low" : "Medium"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-medium leading-relaxed text-foreground">{action.text}</p>
                          <Link
                            to={scope.link}
                            onClick={() => onOpenChange(false)}
                            className="mt-0.5 inline-flex items-center text-xs text-muted-foreground hover:text-primary"
                          >
                            {scope.name}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {aggregated.questions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-rose-500" />
                    <p className="text-base font-semibold text-muted-foreground">
                      Open questions
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {aggregated.questions.slice(0, 8).map(({ scope, text }, i) => (
                      <li key={`${scope.scope_id}-q-${i}`}>
                        <p className="text-base leading-relaxed text-foreground">{text}</p>
                        <Link
                          to={scope.link}
                          onClick={() => onOpenChange(false)}
                          className="mt-0.5 inline-flex items-center text-xs text-muted-foreground hover:text-primary"
                        >
                          {scope.name}
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Per-thread cards */}
              <div className="mb-2 mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By thread
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setRunId((n) => n + 1)}
                  disabled={totalLoading > 0}
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </Button>
              </div>

              <div className="space-y-2">
                {perScope.map((p) => (
                  <ThreadCard key={`${p.ref.scope_type}-${p.ref.scope_id}`} item={p} onOpen={() => onOpenChange(false)} />
                ))}
              </div>

              {allEmpty && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Nothing urgent in your unread threads.
                </p>
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

function ThreadCard({ item, onOpen }: { item: PerScope; onOpen: () => void }) {
  const { ref, loading, error, result } = item;
  const n = normalise(result?.summary);

  return (
    <Link
      to={ref.link}
      onClick={onOpen}
      className="block rounded-xl border border-border bg-card p-3 transition active:scale-[0.99] hover:border-primary/40"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{ref.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ref.unreadCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {ref.unreadCount > 99 ? "99+" : ref.unreadCount}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {loading && (
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {!loading && error && error !== "unsupported" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          {error === "digests_missing"
            ? "Recap not ready for this thread yet."
            : error === "sensitive_content"
              ? "Sensitive content — read directly."
              : error === "no_messages"
                ? "No recent messages."
                : "Couldn't summarise this thread."}
        </p>
      )}

      {!loading && error === "unsupported" && (
        <p className="text-xs text-muted-foreground">Open the thread to see new messages.</p>
      )}

      {!loading && !error && result && (
        <>
          {n.headline && <p className="text-sm leading-snug text-foreground">{n.headline}</p>}
          {(n.actions.length > 0 || n.questions.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {n.actions.length > 0 && (
                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {n.actions.length} action{n.actions.length === 1 ? "" : "s"}
                </span>
              )}
              {n.questions.length > 0 && (
                <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {n.questions.length} question{n.questions.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Link>
  );
}
