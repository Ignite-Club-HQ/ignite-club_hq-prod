// Hourly export of public.write_audit_log rows to Storage as JSONL.
// Files: audit-log-exports/YYYY/MM/DD/HH-<batchStart>.jsonl
// Cursor: app_settings.value.last_id under key 'write_audit_export_cursor'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 20; // safety cap: 100k rows/run

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Load cursor
    const { data: cursorRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "write_audit_export_cursor")
      .maybeSingle();

    let lastId: number = Number(cursorRow?.value?.last_id ?? 0);
    let totalExported = 0;
    let batches = 0;
    let filesWritten: string[] = [];

    while (batches < MAX_BATCHES_PER_RUN) {
      const { data: rows, error } = await supabase
        .from("write_audit_log")
        .select("*")
        .gt("id", lastId)
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) throw error;
      if (!rows || rows.length === 0) break;

      const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const startId = rows[0].id;
      const endId = rows[rows.length - 1].id;
      const path = `${yyyy}/${mm}/${dd}/${hh}-${startId}-${endId}.jsonl`;

      const { error: upErr } = await supabase.storage
        .from("audit-log-exports")
        .upload(path, new Blob([jsonl], { type: "application/x-ndjson" }), {
          contentType: "application/x-ndjson",
          upsert: false,
        });
      if (upErr) throw upErr;

      lastId = endId;
      totalExported += rows.length;
      filesWritten.push(path);
      batches++;

      // Persist cursor after every batch so partial runs are recoverable
      await supabase.from("app_settings").upsert(
        {
          key: "write_audit_export_cursor",
          value: { last_id: lastId, updated_at: new Date().toISOString() },
          description: "Cursor for write_audit_log export to Storage",
        },
        { onConflict: "key" },
      );

      if (rows.length < BATCH_SIZE) break;
    }

    return new Response(
      JSON.stringify({ ok: true, exported: totalExported, files: filesWritten, cursor: lastId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("export-write-audit failed:", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
