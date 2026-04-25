// One-shot admin utility: wipe a club's vault (vault_files rows + their storage objects ONLY).
// Authenticated via ADMIN_DELETE_SECRET header.
//
// IMPORTANT: This function MUST NOT delete arbitrary objects under clubs/{clubId}/.
// The `photos` storage bucket is shared with the media gallery (photos table) and other
// features that use the same prefix. Deleting by prefix previously wiped gallery images.
// Instead, we only delete storage paths that are explicitly referenced by vault_files.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminSecret = Deno.env.get("ADMIN_DELETE_SECRET");
    const provided = req.headers.get("x-admin-secret");
    if (!adminSecret || provided !== adminSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { clubId, bucket = "photos" } = await req.json();
    if (!clubId) {
      return new Response(JSON.stringify({ error: "clubId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Pull all vault_files for this club so we know exactly which storage paths to remove.
    const { data: vaultRows, error: fetchErr } = await supabase
      .from("vault_files")
      .select("id, storage_path, storage_bucket")
      .eq("club_id", clubId);
    if (fetchErr) throw fetchErr;

    // Group paths by bucket (default to provided bucket if column not set)
    const pathsByBucket: Record<string, string[]> = {};
    for (const row of vaultRows ?? []) {
      const b = (row as any).storage_bucket || bucket;
      const p = (row as any).storage_path as string | null;
      if (!p) continue;
      if (!pathsByBucket[b]) pathsByBucket[b] = [];
      pathsByBucket[b].push(p);
    }

    let removed = 0;
    for (const [b, paths] of Object.entries(pathsByBucket)) {
      // de-dupe
      const unique = Array.from(new Set(paths));
      for (let i = 0; i < unique.length; i += 1000) {
        const batch = unique.slice(i, i + 1000);
        const { error } = await supabase.storage.from(b).remove(batch);
        if (error) throw error;
        removed += batch.length;
      }
    }

    // Delete vault_files rows for this club
    const { error: dbErr, count } = await supabase
      .from("vault_files")
      .delete({ count: "exact" })
      .eq("club_id", clubId);
    if (dbErr) throw dbErr;

    return new Response(
      JSON.stringify({ ok: true, clubId, storageObjectsRemoved: removed, vaultFilesDeleted: count ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
