import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RestoreRequest {
  backupName: string;
  paths: string[];
  restoreMode: "files_only" | "full"; // files_only = just media, full = all data
}

interface RestoreResult {
  type: string;
  count: number;
  errors: string[];
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

    const { backupName, paths, restoreMode = "files_only" }: RestoreRequest = await req.json();
    
    if (!backupName || !paths || paths.length === 0) {
      return new Response(JSON.stringify({ error: "backupName and paths are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Restoring from backup: ${backupName}, mode: ${restoreMode}, paths: ${paths.length}`);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Download backup
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

    const arrayBuffer = await zipData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Parse manifest
    let manifest: { clubs?: { id: string; name: string }[]; teams?: { id: string; name: string; club_id: string | null }[] } | null = null;
    const manifestFile = zip.file("_manifest.json");
    if (manifestFile) {
      manifest = JSON.parse(await manifestFile.async("text"));
    }

    // Build name-to-ID maps
    const clubNameToId = new Map<string, string>();
    const teamNameToId = new Map<string, string>();
    manifest?.clubs?.forEach(c => clubNameToId.set(c.name, c.id));
    manifest?.teams?.forEach(t => teamNameToId.set(t.name, t.id));

    const results: RestoreResult[] = [];
    let totalRestored = 0;
    let totalErrors = 0;
    const allErrors: string[] = [];

    // Group paths by type
    const clubInfoPaths: string[] = [];
    const teamInfoPaths: string[] = [];
    const eventPaths: string[] = [];
    const messagePaths: string[] = [];
    const photoPaths: string[] = [];
    const filePaths: string[] = [];
    const otherJsonPaths: string[] = [];

    for (const path of paths) {
      if (path.endsWith("_club_info.json")) {
        clubInfoPaths.push(path);
      } else if (path.endsWith("_team_info.json")) {
        teamInfoPaths.push(path);
      } else if (path.includes("/events/") && path.endsWith(".json")) {
        eventPaths.push(path);
      } else if (path.includes("/messages/") && path.endsWith(".json")) {
        messagePaths.push(path);
      } else if (path.includes("/photos/") && !path.endsWith(".json")) {
        photoPaths.push(path);
      } else if (path.includes("/files/") && !path.endsWith(".json")) {
        filePaths.push(path);
      } else if (path.endsWith(".json")) {
        otherJsonPaths.push(path);
      }
    }

    // Helper to parse path for club/team context
    const parseContext = (path: string): { clubId: string | null; teamId: string | null; clubName: string | null; teamName: string | null } => {
      const parts = path.split("/");
      let clubName: string | null = null;
      let teamName: string | null = null;
      
      if (parts[0] === "clubs" && parts.length >= 2) {
        clubName = parts[1];
        if (parts.length >= 4 && parts[2] === "teams") {
          teamName = parts[3];
        }
      }
      
      return {
        clubId: clubName ? clubNameToId.get(clubName) || null : null,
        teamId: teamName ? teamNameToId.get(teamName) || null : null,
        clubName,
        teamName,
      };
    };

    // Restore photos
    if (photoPaths.length > 0) {
      let photoCount = 0;
      const photoErrors: string[] = [];

      for (const path of photoPaths) {
        try {
          const file = zip.file(path);
          if (!file) continue;

          const { clubId, teamId } = parseContext(path);
          if (!clubId && !teamId) {
            photoErrors.push(`No context for: ${path}`);
            continue;
          }

          // Verify club/team exists
          if (clubId) {
            const { data: exists } = await adminClient.from("clubs").select("id").eq("id", clubId).maybeSingle();
            if (!exists) {
              photoErrors.push(`Club not found: ${path}`);
              continue;
            }
          }
          if (teamId) {
            const { data: exists } = await adminClient.from("teams").select("id, club_id").eq("id", teamId).maybeSingle();
            if (!exists) {
              photoErrors.push(`Team not found: ${path}`);
              continue;
            }
          }

          const content = await file.async("uint8array");
          const fileName = path.split("/").pop() || "photo.jpg";
          const storagePath = `restored/${Date.now()}_${fileName}`;

          const { error: uploadError } = await adminClient.storage
            .from("photos")
            .upload(storagePath, content, { contentType: "image/jpeg" });

          if (uploadError) {
            photoErrors.push(`Upload failed: ${path}`);
            continue;
          }

          const { data: urlData } = adminClient.storage.from("photos").getPublicUrl(storagePath);

          await adminClient.from("photos").insert({
            file_url: urlData.publicUrl,
            title: fileName.replace(/\.[^/.]+$/, ""),
            club_id: teamId ? null : clubId,
            team_id: teamId,
            uploader_id: user.id,
            file_size: content.length,
            show_in_feed: false,
          });

          photoCount++;
        } catch (err) {
          photoErrors.push(`Error: ${path}`);
        }
      }

      results.push({ type: "photos", count: photoCount, errors: photoErrors });
      totalRestored += photoCount;
      totalErrors += photoErrors.length;
      allErrors.push(...photoErrors);
    }

    // Restore vault files
    if (filePaths.length > 0) {
      let fileCount = 0;
      const fileErrors: string[] = [];

      for (const path of filePaths) {
        try {
          const file = zip.file(path);
          if (!file) continue;

          const { clubId, teamId } = parseContext(path);
          if (!clubId && !teamId) {
            fileErrors.push(`No context for: ${path}`);
            continue;
          }

          const content = await file.async("uint8array");
          const fileName = path.split("/").pop() || "file";
          const storagePath = `restored/${Date.now()}_${fileName}`;

          const { error: uploadError } = await adminClient.storage
            .from("chat-attachments")
            .upload(storagePath, content);

          if (uploadError) {
            fileErrors.push(`Upload failed: ${path}`);
            continue;
          }

          const { data: urlData } = adminClient.storage.from("chat-attachments").getPublicUrl(storagePath);

          await adminClient.from("vault_files").insert({
            file_url: urlData.publicUrl,
            name: fileName,
            club_id: teamId ? null : clubId,
            team_id: teamId,
            uploader_id: user.id,
            file_size: content.length,
          });

          fileCount++;
        } catch (err) {
          fileErrors.push(`Error: ${path}`);
        }
      }

      results.push({ type: "files", count: fileCount, errors: fileErrors });
      totalRestored += fileCount;
      totalErrors += fileErrors.length;
      allErrors.push(...fileErrors);
    }

    // Full restore mode - restore data records
    if (restoreMode === "full") {
      // Restore events
      if (eventPaths.length > 0) {
        let eventCount = 0;
        const eventErrors: string[] = [];

        for (const path of eventPaths) {
          try {
            const file = zip.file(path);
            if (!file) continue;

            const content = JSON.parse(await file.async("text"));
            const { clubId, teamId } = parseContext(path);

            if (!clubId) {
              eventErrors.push(`No club context for: ${path}`);
              continue;
            }

            // Check if event already exists
            const { data: existing } = await adminClient
              .from("events")
              .select("id")
              .eq("id", content.event.id)
              .maybeSingle();

            if (existing) {
              // Update existing
              await adminClient.from("events").update({
                title: content.event.title,
                description: content.event.description,
                event_date: content.event.event_date,
                address: content.event.address,
                suburb: content.event.suburb,
                state: content.event.state,
                postcode: content.event.postcode,
                opponent: content.event.opponent,
                type: content.event.type,
              }).eq("id", content.event.id);
            } else {
              // Insert new (with new ID to avoid conflicts)
              const { error: insertError } = await adminClient.from("events").insert({
                club_id: clubId,
                team_id: teamId,
                title: content.event.title,
                description: content.event.description,
                event_date: content.event.event_date,
                address: content.event.address,
                suburb: content.event.suburb,
                state: content.event.state,
                postcode: content.event.postcode,
                opponent: content.event.opponent,
                type: content.event.type,
                created_by: user.id,
              });

              if (insertError) {
                eventErrors.push(`Insert failed: ${path} - ${insertError.message}`);
                continue;
              }
            }

            eventCount++;
          } catch (err) {
            eventErrors.push(`Error: ${path}`);
          }
        }

        results.push({ type: "events", count: eventCount, errors: eventErrors });
        totalRestored += eventCount;
        totalErrors += eventErrors.length;
        allErrors.push(...eventErrors);
      }

      // Restore other JSON data (sponsors, rewards, roles, etc.)
      for (const path of otherJsonPaths) {
        try {
          const file = zip.file(path);
          if (!file) continue;

          const content = JSON.parse(await file.async("text"));
          const { clubId, teamId } = parseContext(path);

          // Handle different types based on path
          if (path.includes("/sponsors/sponsors.json") && Array.isArray(content)) {
            for (const sponsor of content) {
              const { data: existing } = await adminClient
                .from("sponsors")
                .select("id")
                .eq("id", sponsor.id)
                .maybeSingle();

              if (!existing && clubId) {
                await adminClient.from("sponsors").insert({
                  club_id: clubId,
                  name: sponsor.name,
                  logo_url: sponsor.logo_url,
                  website_url: sponsor.website_url,
                  is_active: sponsor.is_active,
                });
                totalRestored++;
              }
            }
          }

          if (path.includes("/rewards/rewards.json") && Array.isArray(content)) {
            for (const reward of content) {
              const { data: existing } = await adminClient
                .from("club_rewards")
                .select("id")
                .eq("id", reward.id)
                .maybeSingle();

              if (!existing && clubId) {
                await adminClient.from("club_rewards").insert({
                  club_id: clubId,
                  name: reward.name,
                  description: reward.description,
                  points_required: reward.points_required,
                  reward_type: reward.reward_type,
                  is_active: reward.is_active,
                });
                totalRestored++;
              }
            }
          }

          if (path.includes("/vault_folders.json") && Array.isArray(content)) {
            for (const folder of content) {
              const { data: existing } = await adminClient
                .from("vault_folders")
                .select("id")
                .eq("id", folder.id)
                .maybeSingle();

              if (!existing) {
                await adminClient.from("vault_folders").insert({
                  name: folder.name,
                  club_id: folder.club_id,
                  team_id: folder.team_id,
                  parent_id: folder.parent_id ?? folder.parent_folder_id ?? null,
                  created_by: user.id,
                });
                totalRestored++;
              }
            }
          }

        } catch (err) {
          console.error(`Error restoring ${path}:`, err);
        }
      }
    }

    console.log(`Restore complete: ${totalRestored} items, ${totalErrors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        totalRestored,
        totalErrors,
        results,
        errors: allErrors.slice(0, 20),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Restore error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
