import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
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

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify caller is app_admin
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "app_admin")
      .maybeSingle();

    if (!roleRow) {
      console.warn(`Unauthorized temp password attempt by ${user.id}`);
      return new Response(JSON.stringify({ error: "App admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    const password = (body?.password ?? "").toString();

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find user by email via admin listUsers (paginated search)
    let targetUserId: string | null = null;
    let targetEmail: string | null = null;
    let page = 1;
    const perPage = 1000;
    while (page < 50) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error("listUsers error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to look up user" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (match) {
        targetUserId = match.id;
        targetEmail = match.email ?? email;
        break;
      }
      if (data.users.length < perPage) break;
      page++;
    }

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "No user found with that email" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
      password,
    });

    if (updateError) {
      console.error("updateUserById error:", updateError.message);
      return new Response(JSON.stringify({ error: updateError.message || "Failed to update password" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log
    await adminClient.from("audit_logs").insert({
      action_type: "admin_set_temp_password",
      actor_id: user.id,
      target_user_id: targetUserId,
      target_user_name: targetEmail,
      details: { email: targetEmail },
    });

    console.log(`Admin ${user.id} set temp password for ${targetUserId}`);

    return new Response(
      JSON.stringify({ success: true, email: targetEmail, user_id: targetUserId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("admin-set-temp-password error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
