// Weekly orphan-duplicate child audit.
//
// Reports children created more than 7 days ago that have zero team
// assignments AND zero guardian links — the signature of an orphan duplicate
// created by the old parent-side insert path. Read-only: it never mutates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { requireServiceRoleAuth } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notification-auth-probe",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await requireServiceRoleAuth(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Paged scan: a single .limit(1000) would re-audit the same oldest page for
    // ever once unresolved orphans exceed the page size, hiding newer ones.
    const PAGE = 1000;
    const MAX_PAGES = 25;
    let scanned = 0;
    const orphans: Array<Record<string, unknown>> = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const { data: candidates, error: childrenError } = await supabase
        .from("children")
        .select("id, name, year_of_birth, parent_id, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (childrenError) throw childrenError;

      const ids = (candidates ?? []).map((c) => c.id);
      if (ids.length === 0) break;
      scanned += ids.length;

      const [{ data: assignments, error: aErr }, { data: guardians, error: gErr }] =
        await Promise.all([
          supabase.from("child_team_assignments").select("child_id").in("child_id", ids),
          supabase
            .from("child_guardians")
            .select("child_id, guardian_id")
            .in("child_id", ids),
        ]);
      if (aErr) throw aErr;
      if (gErr) throw gErr;

      // The creating parent's own guardian link does not make a child
      // "referenced": upsert_child_for_guardian always writes one, so counting
      // it would hide every orphan duplicate created through the RPC path.
      const parentById = new Map(
        (candidates ?? []).map((c) => [c.id as string, c.parent_id as string | null]),
      );
      const referenced = new Set<string>([
        ...(assignments ?? []).map((r) => r.child_id as string),
        ...(guardians ?? [])
          .filter((r) => {
            const parentId = parentById.get(r.child_id as string) ?? null;
            return parentId === null || r.guardian_id !== parentId;
          })
          .map((r) => r.child_id as string),
      ]);

      for (const c of candidates ?? []) {
        if (!referenced.has(c.id)) orphans.push(c as Record<string, unknown>);
      }

      if (ids.length < PAGE) break;
    }

    console.log(`[audit-orphan-children] scanned=${scanned} orphans=${orphans.length}`);

    return new Response(
      JSON.stringify({ ok: true, scanned, orphan_count: orphans.length, orphans }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    console.error("[audit-orphan-children] failed:", error);
    return new Response(
      JSON.stringify({ ok: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
