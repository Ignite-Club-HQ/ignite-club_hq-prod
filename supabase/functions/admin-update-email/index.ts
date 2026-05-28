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
    const cronSecret = req.headers.get("x-cron-secret");
    const expected = Deno.env.get("CRON_SECRET");
    if (!cronSecret || cronSecret !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => null);
    const userId = (body?.userId ?? "").toString().trim();
    const email = (body?.email ?? "").toString().trim().toLowerCase();

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });

    if (updateError) {
      console.error("updateUserById error:", updateError.message);
      return new Response(
        JSON.stringify({ error: updateError.message || "Failed to update email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await adminClient.from("audit_logs").insert({
      action_type: "admin_update_email",
      actor_id: "00000000-0000-0000-0000-000000000000",
      target_user_id: userId,
      details: { email, reason: "Corrected typo in email domain" },
    });

    return new Response(
      JSON.stringify({ success: true, user_id: userId, email }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("admin-update-email error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
