import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify cron secret for scheduled invocations
    const authHeader = req.headers.get("Authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find all accounts scheduled for deletion that have passed their deletion date
    const { data: accountsToDelete, error: fetchError } = await adminClient
      .from('profiles')
      .select('id')
      .not('scheduled_deletion_at', 'is', null)
      .lt('scheduled_deletion_at', new Date().toISOString());

    if (fetchError) {
      console.error("Error fetching accounts to delete:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!accountsToDelete || accountsToDelete.length === 0) {
      console.log("No accounts to delete");
      return new Response(
        JSON.stringify({ success: true, deletedCount: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let deletedCount = 0;
    let storageFilesRemoved = 0;
    const errors: string[] = [];

    for (const account of accountsToDelete) {
      try {
        // 1. Delete user's photos from storage
        const { data: userPhotos } = await adminClient
          .from("photos")
          .select("id, image_url, file_url")
          .eq("uploader_id", account.id);

        if (userPhotos) {
          for (const photo of userPhotos) {
            const url = photo.file_url || photo.image_url;
            if (url) {
              const storagePath = extractStoragePath(url, "photos");
              if (storagePath) {
                const { error: storageError } = await adminClient.storage
                  .from("photos")
                  .remove([storagePath]);
                if (!storageError) storageFilesRemoved++;
              }
            }
          }
        }

        // 2. Delete user's vault files from storage
        const { data: userFiles } = await adminClient
          .from("vault_files")
          .select("id, file_url, is_external_link")
          .eq("uploaded_by", account.id);

        if (userFiles) {
          for (const file of userFiles) {
            if (!file.is_external_link && file.file_url) {
              for (const bucket of ["photos", "vault-files"]) {
                const storagePath = extractStoragePath(file.file_url, bucket);
                if (storagePath) {
                  const { error: storageError } = await adminClient.storage
                    .from(bucket)
                    .remove([storagePath]);
                  if (!storageError) {
                    storageFilesRemoved++;
                    break;
                  }
                }
              }
            }
          }
        }

        // 3. Delete user's profile avatar from storage if exists
        const { data: profile } = await adminClient
          .from("profiles")
          .select("avatar_url")
          .eq("id", account.id)
          .maybeSingle();

        if (profile?.avatar_url) {
          const avatarPath = extractStoragePath(profile.avatar_url, "avatars");
          if (avatarPath) {
            await adminClient.storage.from("avatars").remove([avatarPath]);
          }
        }

        // 4. Delete the auth user (cascades DB records via foreign keys)
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(account.id);
        
        if (deleteError) {
          console.error(`Error deleting user ${account.id}:`, deleteError);
          errors.push(`${account.id}: ${deleteError.message}`);
        } else {
          console.log(`Successfully deleted user ${account.id} (${storageFilesRemoved} storage files cleaned)`);
          deletedCount++;
        }
      } catch (userError) {
        console.error(`Error processing user ${account.id}:`, userError);
        errors.push(`${account.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedCount,
        storageFilesRemoved,
        totalScheduled: accountsToDelete.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
