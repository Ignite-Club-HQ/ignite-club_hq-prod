// Webhook endpoint for external EOI submissions (club websites, CRMs, etc.)
// Accepts POST requests with player/parent data and creates EOI submissions
// Authentication via X-Webhook-Token header

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-webhook-token, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WebhookPayload {
  club_id: string;
  season_id: string;
  parent_name: string;
  parent_email: string;
  parent_mobile?: string;
  player_name: string;
  player_dob?: string;
  player_gender?: string;
  preferred_teammates?: string;
  preferred_position?: string;
  skill_level?: number;
  training_days?: string[];
  game_days?: string[];
  notes?: string;
  source?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const token = req.headers.get("x-webhook-token");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing X-Webhook-Token header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as WebhookPayload;
    
    // Validate required fields
    if (!body.club_id || !body.season_id || !body.parent_name || !body.parent_email || !body.player_name) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields",
          required: ["club_id", "season_id", "parent_name", "parent_email", "player_name"]
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Validate webhook token
    const { data: tokenValid, error: tokenError } = await admin.rpc(
      "validate_eoi_webhook_token", 
      { _club_id: body.club_id, _token: token }
    );

    if (tokenError || !tokenValid) {
      return new Response(JSON.stringify({ error: "Invalid webhook token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check season is open for EOIs
    const { data: season } = await admin
      .from("seasons")
      .select("id, name, eoi_enabled, eoi_opens_at, eoi_closes_at")
      .eq("id", body.season_id)
      .eq("club_id", body.club_id)
      .maybeSingle();

    if (!season || !season.eoi_enabled) {
      return new Response(JSON.stringify({ error: "EOI not enabled for this season" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    if (season.eoi_opens_at && now < season.eoi_opens_at) {
      return new Response(JSON.stringify({ error: "EOI not yet open" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (season.eoi_closes_at && now > season.eoi_closes_at) {
      return new Response(JSON.stringify({ error: "EOI closed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the submission
    const { data: inserted, error: insertError } = await admin
      .from("eoi_submissions")
      .insert({
        club_id: body.club_id,
        season_id: body.season_id,
        parent_name: body.parent_name.trim(),
        parent_email: body.parent_email.trim().toLowerCase(),
        parent_mobile: body.parent_mobile?.trim() || null,
        player_name: body.player_name.trim(),
        player_dob: body.player_dob || null,
        player_gender: body.player_gender || null,
        preferred_teammates: body.preferred_teammates?.trim() || null,
        preferred_position: body.preferred_position?.trim() || null,
        skill_level: body.skill_level ?? null,
        training_days: body.training_days || [],
        game_days: body.game_days || [],
        notes: body.notes?.trim() || null,
        source: body.source || "webhook",
        status: "submitted",
      })
      .select("id, claim_token, created_at")
      .single();

    if (insertError || !inserted) {
      console.error("[eoi-webhook] insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create submission" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire magic-link invite (best effort)
    try {
      await admin.functions.invoke("send-eoi-invite", {
        body: { submission_id: inserted.id },
      });
    } catch (e) {
      console.warn("[eoi-webhook] invite send failed:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        submission_id: inserted.id,
        claim_token: inserted.claim_token,
        deep_link: `https://igniteclubhq.app/eoi-complete/${inserted.claim_token}`,
        created_at: inserted.created_at,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[eoi-webhook] error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
