// Admin-only: wipe a club's vault (vault_files rows + their storage objects ONLY).
// Auth: caller must present a valid JWT AND have the `app_admin` role in user_roles.
// (Previously gated by ADMIN_DELETE_SECRET header — replaced 2026-07-15 for defence-in-depth.)
//
// IMPORTANT: This function MUST NOT delete arbitrary objects under clubs/{clubId}/.
// The `photos` storage bucket is shared with the media gallery and other features that use
// the same prefix. Deleting by prefix previously wiped gallery images. Instead, we only
// delete storage paths that are explicitly referenced by vault_files.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Require app_admin role
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "app_admin")
      .maybeSingle();

    if (!roleRow) {
      console.warn(`Unauthorized wipe-club-vault attempt by ${user.id}`);
      return new Response(JSON.stringify({ error: "App admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { clubId, bucket = "photos" } = await req.json();
    if (!clubId) {
      return new Response(JSON.stringify({ error: "clubId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const unique = Array.from(new Set(paths));
      for (let i = 0; i < unique.length; i += 1000) {
        const batch = unique.slice(i, i + 1000);
        const { error } = await supabase.storage.from(b).remove(batch);
        if (error) throw error;
        removed += batch.length;
      }
    }

    const { error: dbErr, count } = await supabase
      .from("vault_files")
      .delete({ count: "exact" })
      .eq("club_id", clubId);
    if (dbErr) throw dbErr;

    await supabase.from("audit_logs").insert({
      action_type: "admin_wipe_club_vault",
      actor_id: user.id,
      details: { clubId, storageObjectsRemoved: removed, vaultFilesDeleted: count ?? 0 },
    });

    console.log(`Admin ${user.id} wiped vault for club ${clubId} (${removed} objects, ${count ?? 0} rows)`);

    return new Response(
      JSON.stringify({ ok: true, clubId, storageObjectsRemoved: removed, vaultFilesDeleted: count ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("wipe-club-vault error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
