import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Extracts the storage path from a full Supabase storage URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/photos/clubs/..." → "clubs/..."
 */
function extractStoragePath(url: string, bucket: string): string | null {
  // Handle both public and signed URL patterns
  const patterns = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/${bucket}/`,
  ];
  for (const pattern of patterns) {
    const idx = url.indexOf(pattern);
    if (idx !== -1) {
      return decodeURIComponent(url.substring(idx + pattern.length).split("?")[0]);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || token);
    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role, club_id")
      .eq("user_id", user.id);

    const isAppAdmin = roles?.some((r: any) => r.role === "app_admin");
    const adminClubIds = roles
      ?.filter((r: any) => r.role === "club_admin")
      .map((r: any) => r.club_id)
      .filter(Boolean) as string[];

    if (!isAppAdmin && (!adminClubIds || adminClubIds.length === 0)) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { photoIds, fileIds, deletionType = "permanent" } = await req.json();

    const results = { photosDeleted: 0, filesDeleted: 0, storageDeleted: 0, errors: [] as string[] };

    // --- Permanently delete photos ---
    if (photoIds && photoIds.length > 0) {
      // Fetch photo records first
      const { data: photos, error: fetchError } = await adminClient
        .from("photos")
        .select("id, image_url, file_url, file_size, club_id, team_id, created_at, uploader_id")
        .in("id", photoIds);

      if (fetchError) {
        results.errors.push(`Failed to fetch photos: ${fetchError.message}`);
      } else if (photos) {
        for (const photo of photos) {
          // Verify club access
          if (!isAppAdmin && photo.club_id && !adminClubIds.includes(photo.club_id)) {
            results.errors.push(`No permission to delete photo ${photo.id}`);
            continue;
          }

          // Delete from storage
          const url = photo.file_url || photo.image_url;
          if (url) {
            const storagePath = extractStoragePath(url, "photos");
            if (storagePath) {
              const { error: storageError } = await adminClient.storage
                .from("photos")
                .remove([storagePath]);
              if (storageError) {
                console.error(`Storage delete failed for ${storagePath}:`, storageError);
                results.errors.push(`Storage delete failed for photo ${photo.id}: ${storageError.message}`);
              } else {
                results.storageDeleted++;
              }
            }
          }

          // Also check for corresponding vault_file and delete it
          if (url) {
            const { data: vaultFile } = await adminClient
              .from("vault_files")
              .select("id, file_url")
              .eq("file_url", url)
              .maybeSingle();

            if (vaultFile) {
              // Log vault file deletion
              await adminClient.from("file_deletion_logs").insert({
                file_id: vaultFile.id,
                club_id: photo.club_id,
                team_id: photo.team_id,
                file_url: vaultFile.file_url,
                deleted_by: user.id,
                deletion_type: deletionType,
                original_created_at: photo.created_at,
                original_uploaded_by: photo.uploader_id,
              });

              await adminClient.from("vault_files").delete().eq("id", vaultFile.id);
            }
          }

          // Log the deletion
          await adminClient.from("photo_deletion_logs").insert({
            photo_id: photo.id,
            club_id: photo.club_id,
            team_id: photo.team_id,
            file_url: photo.file_url,
            image_url: photo.image_url,
            file_size: photo.file_size,
            deleted_by: user.id,
            deletion_type: deletionType,
            original_created_at: photo.created_at,
            original_uploader_id: photo.uploader_id,
          });

          // Hard delete from DB
          const { error: deleteError } = await adminClient
            .from("photos")
            .delete()
            .eq("id", photo.id);

          if (deleteError) {
            results.errors.push(`DB delete failed for photo ${photo.id}: ${deleteError.message}`);
          } else {
            results.photosDeleted++;
          }
        }
      }
    }

    // --- Permanently delete vault files ---
    if (fileIds && fileIds.length > 0) {
      const { data: files, error: fetchError } = await adminClient
        .from("vault_files")
        .select("id, file_url, file_size, name, club_id, team_id, created_at, uploaded_by, is_external_link")
        .in("id", fileIds);

      if (fetchError) {
        results.errors.push(`Failed to fetch files: ${fetchError.message}`);
      } else if (files) {
        for (const file of files) {
          // Verify club access
          if (!isAppAdmin && file.club_id && !adminClubIds.includes(file.club_id)) {
            results.errors.push(`No permission to delete file ${file.id}`);
            continue;
          }

          // Delete from storage (skip external links)
          if (!file.is_external_link && file.file_url) {
            // Try photos bucket first, then vault-files
            for (const bucket of ["photos", "vault-files"]) {
              const storagePath = extractStoragePath(file.file_url, bucket);
              if (storagePath) {
                const { error: storageError } = await adminClient.storage
                  .from(bucket)
                  .remove([storagePath]);
                if (storageError) {
                  console.error(`Storage delete failed for ${bucket}/${storagePath}:`, storageError);
                } else {
                  results.storageDeleted++;
                  break;
                }
              }
            }
          }

          // Log the deletion
          await adminClient.from("file_deletion_logs").insert({
            file_id: file.id,
            club_id: file.club_id,
            team_id: file.team_id,
            file_url: file.file_url,
            file_size: file.file_size,
            file_name: file.name,
            deleted_by: user.id,
            deletion_type: deletionType,
            original_created_at: file.created_at,
            original_uploaded_by: file.uploaded_by,
          });

          // Hard delete from DB
          const { error: deleteError } = await adminClient
            .from("vault_files")
            .delete()
            .eq("id", file.id);

          if (deleteError) {
            results.errors.push(`DB delete failed for file ${file.id}: ${deleteError.message}`);
          } else {
            results.filesDeleted++;
          }
        }
      }
    }

    console.log(
      `Permanent delete by ${user.id}: ${results.photosDeleted} photos, ${results.filesDeleted} files, ${results.storageDeleted} storage files removed`
    );

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
