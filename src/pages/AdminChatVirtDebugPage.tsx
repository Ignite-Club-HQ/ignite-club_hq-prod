import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Copy, Check, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import {
  isChatVirtDebugEnabled,
  setChatVirtDebugEnabled,
  getMeasurementSummary,
  type MeasurementSummary,
} from "@/components/chat/chatVirtDebug";

type DebugEvent = {
  t: number;
  kind:
    | "measure"
    | "key-churn"
    | "anchor"
    | "first-index"
    | "pin"
    | "scrolltop-write"
    | "start-reached"
    | "duplicate-id";
  data: Record<string, unknown>;
};

const KIND_COLORS: Record<DebugEvent["kind"], string> = {
  measure: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "key-churn": "bg-red-500/15 text-red-700 dark:text-red-300",
  anchor: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "first-index": "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  pin: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  "scrolltop-write": "bg-red-500/15 text-red-700 dark:text-red-300",
  "start-reached": "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "duplicate-id": "bg-red-500/15 text-red-700 dark:text-red-300",
};

function readBuffer(): DebugEvent[] {
  if (typeof window === "undefined") return [];
  return (window.__chatVirtDebugBuffer ?? []) as DebugEvent[];
}

export default function AdminChatVirtDebugPage() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState<boolean>(() => isChatVirtDebugEnabled());
  const [paused, setPaused] = useState(false);
  const [filterBigOnly, setFilterBigOnly] = useState(true);
  const [events, setEvents] = useState<DebugEvent[]>(() => readBuffer().slice());
  const [summary, setSummary] = useState<MeasurementSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the in-memory buffer 2x/sec while not paused.
  useEffect(() => {
    if (paused) return;
    intervalRef.current = setInterval(() => {
      setEvents(readBuffer().slice());
      setSummary(getMeasurementSummary());
    }, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused]);

  const handleToggle = (next: boolean) => {
    setChatVirtDebugEnabled(next);
    setEnabled(next);
    if (!next) {
      // Disabling: clear visible events but leave the buffer intact in case
      // it's re-enabled in the same session.
      setEvents([]);
    } else {
      setEvents(readBuffer().slice());
    }
  };

  const handleClear = () => {
    if (typeof window !== "undefined") window.__chatVirtDebugClear?.();
    setEvents([]);
  };

  const visibleEvents = useMemo(() => {
    const list = events.slice().reverse(); // newest first
    if (!filterBigOnly) return list;
    return list.filter((e) => {
      if (e.kind === "measure") {
        const d = (e.data as { delta?: number | null }).delta;
        return typeof d === "number" && Math.abs(d) > 24;
      }
      // Always show non-measure events — they're already rare/important.
      return true;
    });
  }, [events, filterBigOnly]);

  const measureStats = useMemo(() => {
    const measures = events.filter((e) => e.kind === "measure");
    const drifted = measures.filter((e) => {
      const d = (e.data as { delta?: number | null }).delta;
      return typeof d === "number" && Math.abs(d) > 24;
    });
    let maxDelta = 0;
    let avgDelta = 0;
    if (measures.length) {
      const deltas = measures
        .map((e) => Number((e.data as { delta?: number | null }).delta))
        .filter((d) => Number.isFinite(d));
      if (deltas.length) {
        maxDelta = deltas.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0);
        avgDelta = Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length);
      }
    }
    return {
      total: measures.length,
      drifted: drifted.length,
      maxDelta,
      avgDelta,
    };
  }, [events]);

  const handleCopy = async () => {
    const payload = JSON.stringify(visibleEvents, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast({ title: "Copied", description: `${visibleEvents.length} events copied to clipboard` });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Could not access clipboard", variant: "destructive" });
    }
  };

  const handleCopySummary = async () => {
    const snapshot = summary ?? getMeasurementSummary();
    const payload = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setSummaryCopied(true);
      toast({
        title: "Summary copied",
        description: `${snapshot.byType.length} row types, ${snapshot.totalMeasurements} measurements`,
      });
      setTimeout(() => setSummaryCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Could not access clipboard", variant: "destructive" });
    }
  };
  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Chat Virtualisation Debug</h1>
          <p className="text-sm text-muted-foreground">
            Live row-height drift, key churn and scroll-ownership events
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Controls</CardTitle>
          <CardDescription>
            Enable instrumentation, then open any chat and scroll. Events stream here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="virt-debug-enabled" className="font-medium">
                Instrumentation
              </Label>
              <p className="text-xs text-muted-foreground">
                Persisted in localStorage. Safe to leave on briefly — adds light per-row logging.
              </p>
            </div>
            <Switch
              id="virt-debug-enabled"
              checked={enabled}
              onCheckedChange={handleToggle}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="virt-debug-bigonly" className="font-medium">
                Show only mis-estimates &gt; 24px
              </Label>
              <p className="text-xs text-muted-foreground">
                Hide healthy rows so the actual jolt-causing rows stand out.
              </p>
            </div>
            <Switch
              id="virt-debug-bigonly"
              checked={filterBigOnly}
              onCheckedChange={setFilterBigOnly}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaused((p) => !p)}
              disabled={!enabled}
            >
              {paused ? <Play className="h-4 w-4 mr-1.5" /> : <Pause className="h-4 w-4 mr-1.5" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear} disabled={!enabled}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={visibleEvents.length === 0}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              Copy {visibleEvents.length} as JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Row Height Stats</CardTitle>
          <CardDescription>
            Aggregated across the {events.filter((e) => e.kind === "measure").length} most recent measurements
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">Measured</p>
              <p className="text-lg font-semibold">{measureStats.total}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">Drifted &gt;24px</p>
              <p className="text-lg font-semibold">{measureStats.drifted}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">Max delta</p>
              <p className="text-lg font-semibold">{measureStats.maxDelta > 0 ? "+" : ""}{measureStats.maxDelta}px</p>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">Avg delta</p>
              <p className="text-lg font-semibold">{measureStats.avgDelta > 0 ? "+" : ""}{measureStats.avgDelta}px</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Per-Type Drift Summary</CardTitle>
              <CardDescription>
                {summary
                  ? `${summary.totalMeasurements} measurements across ${summary.byType.length} row types — ${summary.totalDriftedOver24px} drifted >24px`
                  : "Aggregated estimated vs measured per row type"}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopySummary}
              disabled={!enabled || !summary || summary.byType.length === 0}
            >
              {summaryCopied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              Copy JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!enabled || !summary || summary.byType.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No measurements yet. Open a chat thread and scroll.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="text-left font-medium py-2 pr-3">Type</th>
                    <th className="text-right font-medium py-2 px-2">N</th>
                    <th className="text-right font-medium py-2 px-2">Drift &gt;24</th>
                    <th className="text-right font-medium py-2 px-2">Avg est</th>
                    <th className="text-right font-medium py-2 px-2">Avg meas</th>
                    <th className="text-right font-medium py-2 px-2">Avg Δ</th>
                    <th className="text-right font-medium py-2 px-2">P50 Δ</th>
                    <th className="text-right font-medium py-2 px-2">P95 Δ</th>
                    <th className="text-right font-medium py-2 pl-2">Max |Δ|</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {summary.byType.map((row) => {
                    const driftPct = row.count > 0 ? (row.driftedOver24px / row.count) * 100 : 0;
                    const hot = driftPct >= 25;
                    return (
                      <tr key={row.type} className="border-b border-border/30">
                        <td className="py-1.5 pr-3 font-sans">
                          <Badge variant="secondary" className={hot ? "bg-red-500/15 text-red-700 dark:text-red-300" : ""}>
                            {row.type}
                          </Badge>
                        </td>
                        <td className="text-right px-2">{row.count}</td>
                        <td className="text-right px-2">
                          {row.driftedOver24px}
                          <span className="text-muted-foreground"> ({Math.round(driftPct)}%)</span>
                        </td>
                        <td className="text-right px-2">{row.avgEstimated}</td>
                        <td className="text-right px-2">{row.avgMeasured}</td>
                        <td className={`text-right px-2 ${row.avgDelta > 0 ? "text-amber-600 dark:text-amber-400" : row.avgDelta < 0 ? "text-blue-600 dark:text-blue-400" : ""}`}>
                          {row.avgDelta > 0 ? "+" : ""}{row.avgDelta}
                        </td>
                        <td className="text-right px-2">{row.p50Delta > 0 ? "+" : ""}{row.p50Delta}</td>
                        <td className="text-right px-2">{row.p95Delta > 0 ? "+" : ""}{row.p95Delta}</td>
                        <td className="text-right pl-2">{row.maxAbsDelta}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Event Stream</CardTitle>
          <CardDescription>
            Newest first. Positive delta = row is taller than estimate (causes downward jolt as paddingTop shrinks).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!enabled ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Enable instrumentation above, then open a chat and scroll.
            </p>
          ) : visibleEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No events yet. Open a chat thread and scroll up.
            </p>
          ) : (
            <ScrollArea className="h-[400px] pr-3">
              <ul className="space-y-1.5 font-mono text-xs">
                {visibleEvents.map((e, i) => (
                  <li
                    key={`${e.t}-${i}`}
                    className="flex items-start gap-2 p-2 rounded border border-border/50 bg-card"
                  >
                    <Badge variant="secondary" className={`shrink-0 ${KIND_COLORS[e.kind]}`}>
                      {e.kind}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(e.t).toLocaleTimeString()}
                      </p>
                      <pre className="whitespace-pre-wrap break-all text-foreground/90">
                        {JSON.stringify(e.data)}
                      </pre>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
