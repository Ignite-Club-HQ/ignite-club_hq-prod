import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const errors: string[] = [];

    for (const account of accountsToDelete) {
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(account.id);
      
      if (deleteError) {
        console.error(`Error deleting user ${account.id}:`, deleteError);
        errors.push(`${account.id}: ${deleteError.message}`);
      } else {
        console.log(`Successfully deleted user ${account.id}`);
        deletedCount++;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedCount,
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
