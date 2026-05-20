import { useEffect, useState } from "react";
import {
  isMsgPerfEnabled,
  subscribeMsgPerf,
  getRecentMsgPerfEvents,
  clearMsgPerfEvents,
  type MsgPerfEvent,
} from "@/lib/messagesPerf";

/**
 * Floating diagnostic overlay for MessagesPage cold-load timings.
 * Renders only when `?msgPerf=1` or `localStorage.ff:msg-perf=1`.
 * Zero overhead in production for users who never set the flag.
 */
export function MsgPerfOverlay() {
  const [enabled] = useState(() => isMsgPerfEnabled());
  const [events, setEvents] = useState<MsgPerfEvent[]>(() =>
    isMsgPerfEnabled() ? getRecentMsgPerfEvents() : []
  );
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    return subscribeMsgPerf((e) => {
      setEvents((prev) => [...prev, e].slice(-200));
    });
  }, [enabled]);

  if (!enabled) return null;

  // Pair start/end events into a single row per label, plus mark-only rows.
  type Row = { label: string; startMs?: number; endMs?: number; phaseMs?: number; kind: "phase" | "mark" };
  const byLabel = new Map<string, Row>();
  const marks: Row[] = [];
  for (const e of events) {
    if (e.kind === "mark") {
      marks.push({ label: e.label, startMs: e.sinceMountMs, kind: "mark" });
      continue;
    }
    const base = e.label.replace(/:(start|end)$/, "");
    const row = byLabel.get(base) ?? { label: base, kind: "phase" as const };
    if (e.kind === "start") row.startMs = e.sinceMountMs;
    if (e.kind === "end") {
      row.endMs = e.sinceMountMs;
      row.phaseMs = e.phaseMs;
    }
    byLabel.set(base, row);
  }
  const phaseRows = Array.from(byLabel.values()).sort(
    (a, b) => (a.startMs ?? 0) - (b.startMs ?? 0)
  );
  const slowest = [...phaseRows]
    .filter((r) => r.phaseMs !== undefined)
    .sort((a, b) => (b.phaseMs ?? 0) - (a.phaseMs ?? 0))
    .slice(0, 3);
  const slowestSet = new Set(slowest.map((r) => r.label));

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 999999,
        maxWidth: 420,
        maxHeight: collapsed ? 40 : "70vh",
        overflow: "auto",
        background: "rgba(15,15,20,0.92)",
        color: "#fff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        border: "1px solid #444",
        borderRadius: 8,
        padding: collapsed ? "6px 10px" : "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: collapsed ? 0 : 8,
        }}
      >
        <strong style={{ color: "#fbbf24" }}>MsgPerf</strong>
        <span style={{ opacity: 0.7 }}>{phaseRows.length} phases</span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {collapsed ? "▲" : "▼"}
        </button>
        <button
          onClick={() => {
            clearMsgPerfEvents();
            setEvents([]);
          }}
          style={{
            background: "transparent",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          clear
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ marginBottom: 6, color: "#86efac" }}>
            Slowest: {slowest.length === 0
              ? "—"
              : slowest
                  .map((r) => `${r.label} ${(r.phaseMs ?? 0).toFixed(0)}ms`)
                  .join("  •  ")}
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ opacity: 0.6 }}>
                <th style={{ textAlign: "left", paddingRight: 8 }}>phase</th>
                <th style={{ textAlign: "right", paddingRight: 8 }}>start</th>
                <th style={{ textAlign: "right", paddingRight: 8 }}>end</th>
                <th style={{ textAlign: "right" }}>dur</th>
              </tr>
            </thead>
            <tbody>
              {phaseRows.map((r) => (
                <tr
                  key={r.label}
                  style={{
                    color: slowestSet.has(r.label) ? "#fca5a5" : "#fff",
                    opacity: r.endMs === undefined ? 0.55 : 1,
                  }}
                >
                  <td style={{ paddingRight: 8 }}>{r.label}</td>
                  <td style={{ textAlign: "right", paddingRight: 8 }}>
                    {r.startMs !== undefined ? r.startMs.toFixed(0) : "—"}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 8 }}>
                    {r.endMs !== undefined ? r.endMs.toFixed(0) : "…"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {r.phaseMs !== undefined ? r.phaseMs.toFixed(0) : "—"}
                  </td>
                </tr>
              ))}
              {marks.map((m, i) => (
                <tr key={`mark-${i}`} style={{ color: "#93c5fd" }}>
                  <td style={{ paddingRight: 8 }}>◆ {m.label}</td>
                  <td style={{ textAlign: "right", paddingRight: 8 }}>
                    {(m.startMs ?? 0).toFixed(0)}
                  </td>
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
