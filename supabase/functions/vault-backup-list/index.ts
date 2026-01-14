import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BackupEntry {
  path: string;
  name: string;
  size: number;
  isFolder: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user is app admin
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminRole } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "app_admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { backupName } = await req.json();
    if (!backupName) {
      return new Response(JSON.stringify({ error: "backupName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Listing contents of backup: ${backupName}`);

    // Use service role to download backup
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: zipData, error: downloadError } = await adminClient.storage
      .from("backups")
      .download(backupName);

    if (downloadError || !zipData) {
      console.error("Download error:", downloadError);
      return new Response(JSON.stringify({ error: "Failed to download backup" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse ZIP contents
    const arrayBuffer = await zipData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const entries: BackupEntry[] = [];
    const folders = new Set<string>();

    const filePromises: Promise<void>[] = [];
    
    zip.forEach((relativePath, file) => {
      if (relativePath === "_manifest.json") return;
      
      // Track folders
      const parts = relativePath.split("/");
      let folderPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        folderPath += (folderPath ? "/" : "") + parts[i];
        folders.add(folderPath);
      }

      if (!file.dir) {
        // Get file size asynchronously
        filePromises.push(
          file.async("uint8array").then((data) => {
            entries.push({
              path: relativePath,
              name: parts[parts.length - 1],
              size: data.length,
              isFolder: false,
            });
          })
        );
      }
    });

    await Promise.all(filePromises);

    // Add folder entries
    folders.forEach((folderPath) => {
      const parts = folderPath.split("/");
      entries.push({
        path: folderPath,
        name: parts[parts.length - 1],
        size: 0,
        isFolder: true,
      });
    });

    // Sort: folders first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    // Get manifest if available
    let manifest = null;
    const manifestFile = zip.file("_manifest.json");
    if (manifestFile) {
      const manifestText = await manifestFile.async("text");
      manifest = JSON.parse(manifestText);
    }

    console.log(`Found ${entries.length} entries in backup`);

    return new Response(
      JSON.stringify({
        success: true,
        entries,
        manifest,
        totalFiles: entries.filter(e => !e.isFolder).length,
        totalFolders: entries.filter(e => e.isFolder).length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error listing backup:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
