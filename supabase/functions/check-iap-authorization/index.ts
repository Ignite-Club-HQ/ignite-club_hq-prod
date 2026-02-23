import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { productId, entityId, entityType } = await req.json();

    if (!productId || !entityId || !entityType) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStorage = productId.includes("storage");

    if (isStorage || entityType === "club") {
      const { data: isClubAdmin } = await supabase
        .rpc("has_role", { _user_id: user.id, _role: "club_admin", _club_id: entityId, _team_id: null });
      const { data: isAppAdmin } = await supabase
        .rpc("has_role", { _user_id: user.id, _role: "app_admin", _club_id: null, _team_id: null });
      if (!isClubAdmin && !isAppAdmin) {
        return new Response(JSON.stringify({ error: "Only club administrators can purchase this plan" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (entityType === "team") {
      const { data: isTeamAdmin } = await supabase
        .rpc("has_role", { _user_id: user.id, _role: "team_admin", _club_id: null, _team_id: entityId });
      const { data: isCoach } = await supabase
        .rpc("has_role", { _user_id: user.id, _role: "coach", _club_id: null, _team_id: entityId });
      const { data: team } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", entityId)
        .maybeSingle();
      const { data: isClubAdmin } = team?.club_id
        ? await supabase.rpc("has_role", { _user_id: user.id, _role: "club_admin", _club_id: team.club_id, _team_id: null })
        : { data: false };
      const { data: isAppAdmin } = await supabase
        .rpc("has_role", { _user_id: user.id, _role: "app_admin", _club_id: null, _team_id: null });
      if (!isTeamAdmin && !isCoach && !isClubAdmin && !isAppAdmin) {
        return new Response(JSON.stringify({ error: "Only team administrators, coaches, or club administrators can purchase this plan" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ authorized: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[IAP Auth Check] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
