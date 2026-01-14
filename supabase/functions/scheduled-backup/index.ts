import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Retention period in days
const RETENTION_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting scheduled backup job...");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Step 1: Clean up old backups
    console.log(`Cleaning up backups older than ${RETENTION_DAYS} days...`);
    
    const { data: existingBackups, error: listError } = await supabase.storage
      .from("backups")
      .list(undefined, { sortBy: { column: "created_at", order: "asc" } });

    if (listError) {
      console.error("Failed to list existing backups:", listError);
    } else {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
      
      const oldBackups = (existingBackups || []).filter(backup => {
        // Parse date from filename: vault-backup-YYYY-MM-DD.zip
        const match = backup.name.match(/vault-backup-(\d{4}-\d{2}-\d{2})\.zip/);
        if (match) {
          const backupDate = new Date(match[1]);
          return backupDate < cutoffDate;
        }
        // Also check created_at metadata
        if (backup.created_at) {
          return new Date(backup.created_at) < cutoffDate;
        }
        return false;
      });

      if (oldBackups.length > 0) {
        console.log(`Deleting ${oldBackups.length} old backups...`);
        const filesToDelete = oldBackups.map(b => b.name);
        const { error: deleteError } = await supabase.storage
          .from("backups")
          .remove(filesToDelete);
        
        if (deleteError) {
          console.error("Failed to delete old backups:", deleteError);
        } else {
          console.log(`Deleted ${filesToDelete.length} old backups`);
        }
      } else {
        console.log("No old backups to clean up");
      }
    }

    // Step 2: Trigger the main backup function
    console.log("Triggering backup...");
    
    const backupResponse = await fetch(`${supabaseUrl}/functions/v1/vault-backup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
    });

    if (!backupResponse.ok) {
      const errorText = await backupResponse.text();
      console.error("Backup function failed:", errorText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Backup failed: ${backupResponse.status}`,
          details: errorText,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const backupResult = await backupResponse.json();
    console.log("Backup completed:", backupResult);

    return new Response(
      JSON.stringify({
        success: true,
        backup: backupResult,
        cleanup: {
          retention_days: RETENTION_DAYS,
          message: "Old backups cleaned up successfully",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Scheduled backup error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
