import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Extracts the storage path from a full Supabase storage URL.
 */
function extractStoragePath(url: string, bucket: string): string | null {
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
    if (!(await isAuthorizedCronCaller(req))) {
      console.error("Unauthorized: caller is not an authorized cron/internal caller");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, serviceKey!);

    const PURGE_DAYS = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - PURGE_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    let photosDeleted = 0;
    let filesDeleted = 0;
    let storageDeleted = 0;
    const errors: string[] = [];

    // --- Purge soft-deleted photos older than 30 days ---
    const { data: expiredPhotos, error: photoFetchError } = await adminClient
      .from("photos")
      .select("id, image_url, file_url, file_size, club_id, team_id, created_at, uploader_id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoffISO)
      .limit(500); // Process in batches

    if (photoFetchError) {
      errors.push(`Failed to fetch expired photos: ${photoFetchError.message}`);
    } else if (expiredPhotos && expiredPhotos.length > 0) {
      console.log(`Found ${expiredPhotos.length} photos to auto-purge`);

      for (const photo of expiredPhotos) {
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
            } else {
              storageDeleted++;
            }
          }
        }

        // Also clean up corresponding vault_file
        if (url) {
          const { data: vaultFile } = await adminClient
            .from("vault_files")
            .select("id")
            .eq("file_url", url)
            .maybeSingle();

          if (vaultFile) {
            await adminClient.from("vault_files").delete().eq("id", vaultFile.id);
          }
        }

        // Log the auto-purge
        await adminClient.from("photo_deletion_logs").insert({
          photo_id: photo.id,
          club_id: photo.club_id,
          team_id: photo.team_id,
          file_url: photo.file_url,
          image_url: photo.image_url,
          file_size: photo.file_size,
          deleted_by: "00000000-0000-0000-0000-000000000000", // System
          deletion_type: "auto_purge",
          original_created_at: photo.created_at,
          original_uploader_id: photo.uploader_id,
        });

        // Hard delete from DB
        const { error: deleteError } = await adminClient
          .from("photos")
          .delete()
          .eq("id", photo.id);

        if (deleteError) {
          errors.push(`DB delete failed for photo ${photo.id}: ${deleteError.message}`);
        } else {
          photosDeleted++;
        }
      }
    }

    // --- Purge soft-deleted vault_files older than 30 days ---
    const { data: expiredFiles, error: fileFetchError } = await adminClient
      .from("vault_files")
      .select("id, file_url, file_size, name, club_id, team_id, created_at, uploaded_by, is_external_link")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoffISO)
      .limit(500);

    if (fileFetchError) {
      errors.push(`Failed to fetch expired files: ${fileFetchError.message}`);
    } else if (expiredFiles && expiredFiles.length > 0) {
      console.log(`Found ${expiredFiles.length} files to auto-purge`);

      for (const file of expiredFiles) {
        if (!file.is_external_link && file.file_url) {
          for (const bucket of ["photos", "vault-files"]) {
            const storagePath = extractStoragePath(file.file_url, bucket);
            if (storagePath) {
              const { error: storageError } = await adminClient.storage
                .from(bucket)
                .remove([storagePath]);
              if (!storageError) {
                storageDeleted++;
                break;
              }
            }
          }
        }

        // Log
        await adminClient.from("file_deletion_logs").insert({
          file_id: file.id,
          club_id: file.club_id,
          team_id: file.team_id,
          file_url: file.file_url,
          file_size: file.file_size,
          file_name: file.name,
          deleted_by: "00000000-0000-0000-0000-000000000000",
          deletion_type: "auto_purge",
          original_created_at: file.created_at,
          original_uploaded_by: file.uploaded_by,
        });

        const { error: deleteError } = await adminClient
          .from("vault_files")
          .delete()
          .eq("id", file.id);

        if (deleteError) {
          errors.push(`DB delete failed for file ${file.id}: ${deleteError.message}`);
        } else {
          filesDeleted++;
        }
      }
    }

    console.log(
      `Auto-purge complete: ${photosDeleted} photos, ${filesDeleted} files, ${storageDeleted} storage files removed`
    );

    return new Response(
      JSON.stringify({
        success: true,
        photosDeleted,
        filesDeleted,
        storageDeleted,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
