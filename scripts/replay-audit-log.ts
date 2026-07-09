#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
/**
 * Replay write-audit-log entries into a restored database.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role> \
 *   deno run --allow-env --allow-net --allow-read scripts/replay-audit-log.ts \
 *     --start "2026-07-08T10:00:00Z" \
 *     --end   "2026-07-08T14:30:00Z" \
 *     [--dry-run] [--tables events,rsvps]
 *
 * How it works:
 *   1. Lists JSONL files in the "audit-log-exports" Storage bucket that could
 *      overlap the window (by YYYY/MM/DD/HH prefix).
 *   2. Streams each row; keeps rows with occurred_at in [start,end].
 *   3. Replays in chronological order:
 *        INSERT -> upsert(row_data)         (preserves original id)
 *        UPDATE -> upsert(row_data)         (idempotent overwrite by id)
 *        DELETE -> delete().eq('id', row_id)
 *
 * MANUAL step. Run only after a DB restore. Point it at prod with the service
 * role key. Dry-run first, review the summary, then rerun without --dry-run.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuditRow = {
  id: number;
  table_name: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  row_id: string | null;
  row_data: Record<string, unknown>;
  old_data: Record<string, unknown> | null;
  actor_id: string | null;
  occurred_at: string;
};

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
const hasFlag = (n: string) => Deno.args.includes(`--${n}`);

const START = arg("start");
const END = arg("end");
const DRY = hasFlag("dry-run");
const ONLY_TABLES = arg("tables")?.split(",").map((s) => s.trim());

if (!START || !END) {
  console.error("Missing --start / --end (ISO timestamps).");
  Deno.exit(1);
}
const startMs = new Date(START).getTime();
const endMs = new Date(END).getTime();
if (!(startMs < endMs)) {
  console.error("Invalid window.");
  Deno.exit(1);
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Enumerate hour-prefixes touching the window (±1h padding for safety)
function hourPrefixes(from: Date, to: Date): string[] {
  const out = new Set<string>();
  const cur = new Date(from.getTime() - 3600_000);
  const stop = new Date(to.getTime() + 3600_000);
  while (cur <= stop) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    const h = String(cur.getUTCHours()).padStart(2, "0");
    out.add(`${y}/${m}/${d}/${h}`);
    cur.setUTCHours(cur.getUTCHours() + 1);
  }
  return [...out];
}

async function listFiles(prefix: string): Promise<string[]> {
  const parts = prefix.split("/");
  const folder = parts.slice(0, 3).join("/");
  const hourTag = parts[3];
  const { data, error } = await supabase.storage
    .from("audit-log-exports")
    .list(folder, { limit: 1000 });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.name.startsWith(`${hourTag}-`))
    .map((f) => `${folder}/${f.name}`);
}

async function fetchRows(path: string): Promise<AuditRow[]> {
  const { data, error } = await supabase.storage.from("audit-log-exports").download(path);
  if (error) throw error;
  const text = await data.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditRow);
}

async function main() {
  const prefixes = hourPrefixes(new Date(START!), new Date(END!));
  const files: string[] = [];
  for (const p of prefixes) files.push(...(await listFiles(p)));
  console.log(`Found ${files.length} audit files touching window.`);

  const rows: AuditRow[] = [];
  for (const f of files) {
    const batch = await fetchRows(f);
    for (const r of batch) {
      const t = new Date(r.occurred_at).getTime();
      if (t < startMs || t > endMs) continue;
      if (ONLY_TABLES && !ONLY_TABLES.includes(r.table_name)) continue;
      rows.push(r);
    }
  }
  rows.sort((a, b) => a.id - b.id);
  console.log(`Replaying ${rows.length} rows${DRY ? " (dry-run)" : ""}...`);

  const summary: Record<string, { insert: number; update: number; delete: number; failed: number }> = {};
  const bump = (t: string, k: "insert" | "update" | "delete" | "failed") => {
    summary[t] ??= { insert: 0, update: 0, delete: 0, failed: 0 };
    summary[t][k]++;
  };

  for (const r of rows) {
    if (DRY) {
      bump(r.table_name, r.operation.toLowerCase() as "insert" | "update" | "delete");
      continue;
    }
    try {
      if (r.operation === "DELETE") {
        if (!r.row_id) throw new Error("DELETE without row_id");
        const { error } = await supabase.from(r.table_name).delete().eq("id", r.row_id);
        if (error) throw error;
        bump(r.table_name, "delete");
      } else {
        const { error } = await supabase.from(r.table_name).upsert(r.row_data as never, { onConflict: "id" });
        if (error) throw error;
        bump(r.table_name, r.operation === "INSERT" ? "insert" : "update");
      }
    } catch (e) {
      console.error(`FAIL ${r.table_name} ${r.operation} id=${r.row_id}:`, (e as Error).message);
      bump(r.table_name, "failed");
    }
  }

  console.log("\nSummary:");
  console.table(summary);
}

main().catch((e) => {
  console.error(e);
  Deno.exit(1);
});
