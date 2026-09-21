// Sends a magic-link style invite to a parent after an EOI submission.
// Uses Supabase Admin API to generate a magiclink for auth, then hands off
// to the existing send-email edge function using the "magic-link" template.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  submission_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const __outboundBlocked = outboundBlockedResponse("send-eoi-invite");
  if (__outboundBlocked) return __outboundBlocked;

  try {
    const body = (await req.json()) as Body;
    if (!body?.submission_id) {
      return new Response(JSON.stringify({ error: "submission_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Load the submission (service role bypasses RLS)
    const { data: sub, error: subErr } = await admin
      .from("eoi_submissions")
      .select(
        "id, club_id, season_id, parent_email, parent_name, player_name, claim_token, invite_sent_count",
      )
      .eq("id", body.submission_id)
      .maybeSingle();

    if (subErr || !sub) {
      return new Response(JSON.stringify({ error: "Submission not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: club } = await admin
      .from("clubs")
      .select("name, logo_url, invite_email_message")
      .eq("id", sub.club_id)
      .maybeSingle();

    // Personal note: one written for this send wins, else the club's saved default.
    const oneOff = ((body as any)?.custom_message ?? "").toString().trim();
    const customMessage = oneOff.length > 0
      ? oneOff
      : ((club?.invite_email_message ?? "").toString().trim() || undefined);

    const { data: season } = await admin
      .from("seasons")
      .select("name")
      .eq("id", sub.season_id)
      .maybeSingle();

    // Deep link: after login we route the user to /eoi-complete/:token
    const redirectTo = `https://igniteclubhq.app/eoi-complete/${sub.claim_token}`;

    // Try to generate a Supabase magic link. If the user doesn't exist yet,
    // fall back to the claim-token URL (signup will auto-claim the EOI).
    let magicLink = redirectTo;
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: sub.parent_email,
        options: { redirectTo },
      });
      if (!linkErr && linkData?.properties?.action_link) {
        magicLink = linkData.properties.action_link;
      }
    } catch (e) {
      console.warn("[send-eoi-invite] magic link generation failed:", e);
    }

    // Fire the email via the existing send-email function
    const { error: emailErr } = await admin.functions.invoke("send-email", {
      body: {
        to: sub.parent_email,
        subject: `Thanks for expressing interest — ${club?.name ?? "your club"}`,
        template: "magic-link",
        templateData: {
          recipientName: sub.parent_name,
          magicLink,
          actionType: "signup",
          appName: "Ignite",
          expiresInMinutes: 60,
          logoUrl: club?.logo_url ?? undefined,
        },
      },
    });

    if (emailErr) {
      console.error("[send-eoi-invite] email error:", emailErr);
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("eoi_submissions")
      .update({
        invite_sent_at: new Date().toISOString(),
        invite_sent_count: (sub.invite_sent_count ?? 0) + 1,
      })
      .eq("id", sub.id);

    return new Response(
      JSON.stringify({ success: true, season: season?.name ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[send-eoi-invite] error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
