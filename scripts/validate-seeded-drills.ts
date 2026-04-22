#!/usr/bin/env -S npx tsx
/**
 * Audit every seeded (is_official=true) drill in Supabase against the
 * coordinate / semantics validator. Writes a markdown report to
 * /mnt/documents/seeded-drill-audit.md.
 *
 * Run with:
 *   npx tsx scripts/validate-seeded-drills.ts
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  formatDrillReport,
  validateDrill,
  type DrillValidationResult,
} from "../src/components/pitch/training/drillValidator";
import type { DrillFrame } from "../src/components/pitch/training/types";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://yabcfiuntwqjwvschnji.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as";

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

  const { data: drills, error: dErr } = await supabase
    .from("drills")
    .select("id, name")
    .eq("is_official", true)
    .order("name");
  if (dErr) throw dErr;
  if (!drills?.length) {
    console.log("No official drills found.");
    return;
  }

  const results: DrillValidationResult[] = [];

  for (const d of drills) {
    const { data: frameRows, error: fErr } = await supabase
      .from("drill_frames")
      .select("id, position, duration_ms, notes, objects, annotations")
      .eq("drill_id", d.id)
      .order("position");
    if (fErr) {
      console.warn(`Failed to load frames for ${d.name}: ${fErr.message}`);
      continue;
    }
    const frames: DrillFrame[] = (frameRows ?? []).map((r: any) => ({
      id: r.id,
      position: r.position,
      durationMs: r.duration_ms ?? 1500,
      notes: r.notes ?? undefined,
      objects: Array.isArray(r.objects) ? r.objects : [],
      annotations: Array.isArray(r.annotations) ? r.annotations : [],
    }));
    results.push(validateDrill({ id: d.id, name: d.name, frames }));
  }

  // Aggregate
  const totals = results.reduce(
    (acc, r) => ({
      error: acc.error + r.counts.error,
      warning: acc.warning + r.counts.warning,
      info: acc.info + r.counts.info,
    }),
    { error: 0, warning: 0, info: 0 }
  );

  const cleanCount = results.filter((r) => r.issues.length === 0).length;
  const dirty = results
    .filter((r) => r.issues.length > 0)
    .sort(
      (a, b) =>
        b.counts.error - a.counts.error ||
        b.counts.warning - a.counts.warning ||
        a.drillName!.localeCompare(b.drillName!)
    );

  const lines: string[] = [];
  lines.push(`# Seeded drill audit`);
  lines.push("");
  lines.push(`- Drills audited: **${results.length}**`);
  lines.push(`- Clean drills: **${cleanCount}**`);
  lines.push(`- Drills with issues: **${results.length - cleanCount}**`);
  lines.push(
    `- Totals — errors: **${totals.error}**, warnings: **${totals.warning}**, info: **${totals.info}**`
  );
  lines.push("");
  lines.push("## Coordinate convention");
  lines.push(
    "y=0 is the top of the pitch (attacking goal), y=100 is the bottom (own goal). " +
      "Forward attacking play moves from HIGH y → LOW y."
  );
  lines.push("");
  lines.push("## Drills with issues");
  lines.push("");
  if (dirty.length === 0) {
    lines.push("_All drills passed validation._");
  } else {
    for (const r of dirty) {
      lines.push("```");
      lines.push(formatDrillReport(r));
      lines.push("```");
      lines.push("");
    }
  }
  lines.push("## Clean drills");
  lines.push("");
  for (const r of results.filter((x) => x.issues.length === 0)) {
    lines.push(`- ✓ ${r.drillName}  (${r.frameCount} frames)`);
  }

  const out = lines.join("\n");
  writeFileSync("/mnt/documents/seeded-drill-audit.md", out, "utf8");

  // Console summary so CI/agents can see at-a-glance pass/fail
  console.log(out);
  console.log(
    `\nReport written → /mnt/documents/seeded-drill-audit.md  ` +
      `(errors=${totals.error}, warnings=${totals.warning})`
  );
  // Non-zero exit on hard errors so this can gate CI later
  if (totals.error > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
