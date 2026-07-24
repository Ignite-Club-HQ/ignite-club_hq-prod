import { Resend } from "https://esm.sh/resend@2.0.0";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders }

  const __outboundBlocked = outboundBlockedResponse("send-feedback-email");
  if (__outboundBlocked) return __outboundBlocked;);
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const { type, title, description, userEmail, userName } = await req.json();

    if (!type || !title) {
      return new Response(
        JSON.stringify({ error: "type and title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendApiKey);

    const typeLabels: Record<string, string> = {
      feature_request: "Feature Request",
      bug: "Bug Report",
      other: "Other",
    };

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #ffffff;">
        <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">📝 New Feedback Submitted</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 120px; vertical-align: top;">Type:</td>
              <td style="padding: 8px 0;">${typeLabels[type] || type}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Title:</td>
              <td style="padding: 8px 0;">${title}</td>
            </tr>
            ${description ? `
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Description:</td>
              <td style="padding: 8px 0;">${description}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">From:</td>
              <td style="padding: 8px 0;">${userName || 'Unknown'} (${userEmail || 'no email'})</td>
            </tr>
          </table>
        </div>
      </body>
      </html>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "Ignite Club HQ <support@igniteclubhq.app>",
      to: ["feedback@igniteclubhq.app"],
      subject: `📝 Feedback: [${typeLabels[type] || type}] ${title}`,
      html: emailHtml,
    });

    if (emailError) {
      console.error("Failed to send feedback email:", emailError);
      throw emailError;
    }

    console.log("Feedback email sent successfully");

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-feedback-email] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
