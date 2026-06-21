import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    const { messageId, messageType, reason, additionalDetails } = await req.json();

    if (!messageId || !messageType || !reason) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine the table based on message type
    const tableMap: Record<string, string> = {
      team: "team_messages",
      club: "club_messages",
      group: "group_messages",
      direct: "direct_messages",
      broadcast: "broadcast_messages",
    };
    const tableName = tableMap[messageType];
    if (!tableName) {
      return new Response(
        JSON.stringify({ error: "Invalid message type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get message details
    const { data: message, error: msgError } = await supabase
      .from(tableName)
      .select("id, text, author_id, created_at, image_url")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      console.error("Message not found:", msgError);
      return new Response(
        JSON.stringify({ error: "Message not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get author and reporter names
    const [authorResult, reporterResult] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", message.author_id).single(),
      supabase.from("profiles").select("display_name").eq("id", userId).single(),
    ]);

    // Get context name (club/team/group name)
    let contextName = messageType;
    if (messageType === "team") {
      const { data: msg } = await supabase.from("team_messages").select("team_id, teams(name)").eq("id", messageId).single();
      contextName = (msg?.teams as any)?.name || "Unknown Team";
    } else if (messageType === "club") {
      const { data: msg } = await supabase.from("club_messages").select("club_id, clubs!club_id(name)").eq("id", messageId).single();
      contextName = (msg?.clubs as any)?.name || "Unknown Club";
    } else if (messageType === "group") {
      const { data: msg } = await supabase.from("group_messages").select("group_id, chat_groups(name)").eq("id", messageId).single();
      contextName = (msg?.chat_groups as any)?.name || "Unknown Group";
    }

    // Insert report
    const { data: report, error: insertError } = await supabase
      .from("message_reports")
      .insert({
        message_id: messageId,
        message_type: messageType,
        reporter_id: userId,
        reason,
        additional_details: additionalDetails || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create report:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create report" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Message report created:", report.id);

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const authorName = authorResult.data?.display_name || "Unknown User";
        const reporterName = reporterResult.data?.display_name || "Unknown User";
        const messageText = message.text || "";

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <div style="background-color: #dc2626; padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">⚠️ Message Report</h1>
              </div>
              <div style="padding: 24px;">
                <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">A chat message has been reported and requires review.</p>
                <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <h2 style="color: #991b1b; font-size: 14px; margin: 0 0 8px; text-transform: uppercase;">Report Details</h2>
                  <p style="color: #374151; margin: 0 0 8px;"><strong>Reason:</strong> ${reason}</p>
                  ${additionalDetails ? `<p style="color: #374151; margin: 0;"><strong>Additional Details:</strong> ${additionalDetails}</p>` : ""}
                </div>
                <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <h2 style="color: #9a3412; font-size: 14px; margin: 0 0 8px; text-transform: uppercase;">Reported Message</h2>
                  <p style="color: #374151; margin: 0; font-style: italic;">"${messageText.length > 300 ? messageText.slice(0, 300) + "…" : messageText}"</p>
                  ${message.image_url ? `<p style="color: #6b7280; margin: 8px 0 0; font-size: 13px;">📎 Message includes an image attachment</p>` : ""}
                </div>
                <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <h2 style="color: #374151; font-size: 14px; margin: 0 0 12px; text-transform: uppercase;">Details</h2>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 4px 0; color: #6b7280; width: 120px;">Report ID:</td><td style="padding: 4px 0; color: #111827;">${report.id}</td></tr>
                    <tr><td style="padding: 4px 0; color: #6b7280;">Message Type:</td><td style="padding: 4px 0; color: #111827;">${messageType} chat</td></tr>
                    <tr><td style="padding: 4px 0; color: #6b7280;">Context:</td><td style="padding: 4px 0; color: #111827;">${contextName}</td></tr>
                    <tr><td style="padding: 4px 0; color: #6b7280;">Author:</td><td style="padding: 4px 0; color: #111827;">${authorName}</td></tr>
                    <tr><td style="padding: 4px 0; color: #6b7280;">Reported By:</td><td style="padding: 4px 0; color: #111827;">${reporterName}</td></tr>
                    <tr><td style="padding: 4px 0; color: #6b7280;">Reported At:</td><td style="padding: 4px 0; color: #111827;">${new Date().toLocaleString("en-AU", { timeZone: "Australia/Adelaide" })}</td></tr>
                  </table>
                </div>
                <p style="color: #6b7280; font-size: 14px; margin: 20px 0 0; text-align: center;">Please review this report in the admin dashboard.</p>
              </div>
              <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">Ignite Club HQ • Message Report System</p>
              </div>
            </div>
          </body>
          </html>
        `;

        const { error: emailError } = await resend.emails.send({
          from: "Ignite Club HQ <support@igniteclubhq.app>",
          to: ["privacy@igniteclubhq.app"],
          subject: `⚠️ Message Report: ${reason} - ${contextName}`,
          html: emailHtml,
        });

        if (emailError) {
          console.error("Failed to send email:", emailError);
        } else {
          console.log("Message report email sent successfully");
        }
      } catch (emailErr) {
        console.error("Email sending error:", emailErr);
      }
    } else {
      console.log("RESEND_API_KEY not configured, skipping email notification");
    }

    return new Response(
      JSON.stringify({ success: true, reportId: report.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-message-report-email:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
