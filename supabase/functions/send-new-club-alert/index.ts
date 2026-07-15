import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-alert-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Simple shared-secret gate so this can't be triggered from the outside.
    const expected = Deno.env.get("NEW_CLUB_ALERT_SECRET");
    const provided = req.headers.get("x-alert-secret");
    if (!expected || provided !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const { club_id } = await req.json();
    if (!club_id) {
      return new Response(JSON.stringify({ error: "club_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: club } = await supabase
      .from("clubs")
      .select("id, name, kind, sport, city, state, country, created_by, created_at, description")
      .eq("id", club_id)
      .single();

    if (!club) {
      return new Response(JSON.stringify({ error: "club not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let creator: { email?: string | null; full_name?: string | null } = {};
    if (club.created_by) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", club.created_by)
        .maybeSingle();
      const { data: userRes } = await supabase.auth.admin.getUserById(club.created_by);
      creator = {
        email: userRes?.user?.email ?? null,
        full_name: profile?.full_name ?? null,
      };
    }

    const location = [club.city, club.state, club.country].filter(Boolean).join(", ") || "—";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #ffffff;">
        <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">🎉 New club created</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding:6px 0; font-weight:bold; width:130px;">Name:</td><td>${club.name ?? "—"}</td></tr>
            <tr><td style="padding:6px 0; font-weight:bold;">Kind:</td><td>${club.kind ?? "club"}</td></tr>
            <tr><td style="padding:6px 0; font-weight:bold;">Sport:</td><td>${club.sport ?? "—"}</td></tr>
            <tr><td style="padding:6px 0; font-weight:bold;">Location:</td><td>${location}</td></tr>
            <tr><td style="padding:6px 0; font-weight:bold; vertical-align:top;">Created by:</td><td>${creator.full_name ?? "Unknown"}${creator.email ? ` &lt;${creator.email}&gt;` : ""}</td></tr>
            <tr><td style="padding:6px 0; font-weight:bold;">Club ID:</td><td><code>${club.id}</code></td></tr>
            <tr><td style="padding:6px 0; font-weight:bold;">Created at:</td><td>${club.created_at ?? ""}</td></tr>
            ${club.description ? `<tr><td style="padding:6px 0; font-weight:bold; vertical-align:top;">Description:</td><td>${club.description}</td></tr>` : ""}
          </table>
        </div>
      </body>
      </html>
    `;

    const resend = new Resend(resendApiKey);
    const { error: emailError } = await resend.emails.send({
      from: "Ignite Club HQ <support@igniteclubhq.app>",
      to: ["contact@igniteclubhq.app"],
      subject: `🎉 New club: ${club.name ?? club.id}`,
      html,
    });

    if (emailError) throw emailError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-new-club-alert] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
