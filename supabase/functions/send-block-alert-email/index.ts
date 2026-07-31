import { requireServiceRoleAuth } from "../_shared/callerAuth.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const __outboundBlocked = outboundBlockedResponse("send-block-alert-email");
  if (__outboundBlocked) return __outboundBlocked;

  const __authError = requireServiceRoleAuth(req, corsHeaders);
  if (__authError) return __authError;


  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const { blockerName, blockerEmail, blockedName, blockedEmail, reason } = await req.json();

    const resend = new Resend(resendApiKey);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #ffffff;">
        <div style="background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">🚫 User Blocked Alert</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 140px; vertical-align: top;">Blocked by:</td>
              <td style="padding: 8px 0;">${blockerName || 'Unknown'} (${blockerEmail || 'no email'})</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Blocked user:</td>
              <td style="padding: 8px 0;">${blockedName || 'Unknown'} (${blockedEmail || 'no email'})</td>
            </tr>
            ${reason ? `
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Reason:</td>
              <td style="padding: 8px 0;">${reason}</td>
            </tr>
            ` : ''}
          </table>
        </div>
      </body>
      </html>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "Ignite Club HQ <support@igniteclubhq.app>",
      to: ["privacy@igniteclubhq.app"],
      subject: `🚫 User Blocked: ${blockerName || 'Unknown'} blocked ${blockedName || 'Unknown'}`,
      html: emailHtml,
    });

    if (emailError) {
      console.error("Failed to send block alert email:", emailError);
      throw emailError;
    }

    console.log("Block alert email sent successfully");

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-block-alert-email] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
