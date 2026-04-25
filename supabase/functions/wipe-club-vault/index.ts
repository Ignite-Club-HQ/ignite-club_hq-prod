// One-shot admin utility: wipe a club's entire vault (storage objects + vault_files rows).
// Authenticated via ADMIN_DELETE_SECRET header.
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

    const prefix = `clubs/${clubId}`;

    // Recursively list all objects under the club prefix
    const allPaths: string[] = [];
    async function walk(folder: string) {
      let offset = 0;
      const limit = 1000;
      while (true) {
        const { data, error } = await supabase.storage.from(bucket).list(folder, { limit, offset });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const item of data) {
          // Storage list returns both files and "folders" (placeholders). Folders have id === null.
          const fullPath = folder ? `${folder}/${item.name}` : item.name;
          if (item.id === null) {
            await walk(fullPath);
          } else {
            allPaths.push(fullPath);
          }
        }
        if (data.length < limit) break;
        offset += limit;
      }
    }
    await walk(prefix);

    // Delete in batches of 1000
    let removed = 0;
    for (let i = 0; i < allPaths.length; i += 1000) {
      const batch = allPaths.slice(i, i + 1000);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) throw error;
      removed += batch.length;
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
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
