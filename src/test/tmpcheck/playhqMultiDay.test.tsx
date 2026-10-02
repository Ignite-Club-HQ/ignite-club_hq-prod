import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { DriblImportMapper, parseDriblRows } from "@/components/DriblImportMapper";
import { playHQToDriblShape } from "@/lib/playhqFixtureImport";

describe("PlayHQ multi-day through mapper", () => {
  it("emits both days", () => {
    const txt = readFileSync("/mnt/user-uploads/advanced_fixture_2026100225502.csv", "utf8");
    const parse = (l: string) => { const o: string[] = []; let c = "", q = false; for (const ch of l) { if (ch == '"') { q = !q; continue } if (ch == ',' && !q) { o.push(c); c = ""; continue } c += ch } o.push(c); return o };
    const lines = txt.split(/\r?\n/).filter(Boolean).map(parse); const h = lines[0];
    const set = (r: string[], k: string, v: string) => { const x = [...r]; x[h.indexOf(k)] = v; return x };
    const rows = [set(set(lines[1], "Game Date", "24/10/2026, 25/10/2026"), "Time", "10:00"), ...lines.slice(2)];
    const conv = playHQToDriblShape(h, rows);
    const onConfirm = vi.fn();
    render(<DriblImportMapper driblRows={parseDriblRows(conv.headers, conv.rows)} teams={[{ id: "t1", name: "U12" } as any]} clubName="Basket Range" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with/ }));
    const fixtures = onConfirm.mock.calls[0][0];
    console.log("total", fixtures.length);
    for (const f of fixtures.filter((f: any) => f.title.includes("Day"))) console.log(f.title, f.date, f.time);
    expect(fixtures.filter((f: any) => f.title.includes("Day")).length).toBe(2);
  });
});
