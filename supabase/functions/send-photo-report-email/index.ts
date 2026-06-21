import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PhotoReportRequest {
  photoId: string;
  reason: string;
  additionalDetails?: string;
}

serve(async (req) => {
  // Handle CORS preflight
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

    // Validate JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    const { photoId, reason, additionalDetails }: PhotoReportRequest = await req.json();

    if (!photoId || !reason) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: photoId and reason" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get photo details
    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select(`
        id,
        image_url,
        file_url,
        created_at,
        uploader_id,
        club_id,
        team_id,
        clubs!club_id(name),
        teams(name)
      `)
      .eq("id", photoId)
      .single();

    if (photoError || !photo) {
      console.error("Photo not found:", photoError);
      return new Response(
        JSON.stringify({ error: "Photo not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get reporter and uploader details
    const [{ data: reporter }, { data: uploader }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", userId).single(),
      supabase.from("profiles").select("display_name").eq("id", photo.uploader_id).single(),
    ]);

    // Insert the report into the database
    const { data: report, error: insertError } = await supabase
      .from("photo_reports")
      .insert({
        photo_id: photoId,
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

    console.log("Photo report created:", report.id);

    // Send email notification if Resend is configured
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        
        const clubName = (photo.clubs as any)?.name || "Unknown Club";
        const teamName = (photo.teams as any)?.name || "N/A";
        const uploaderName = uploader?.display_name || "Unknown User";
        const reporterName = reporter?.display_name || "Unknown User";
        const photoUrl = photo.file_url || photo.image_url;

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <!-- Header -->
              <div style="background-color: #dc2626; padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">⚠️ Photo Report</h1>
              </div>
              
              <!-- Content -->
              <div style="padding: 24px;">
                <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">
                  A photo has been reported by a user and requires review.
                </p>
                
                <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <h2 style="color: #991b1b; font-size: 14px; margin: 0 0 8px; text-transform: uppercase;">Report Details</h2>
                  <p style="color: #374151; margin: 0 0 8px;"><strong>Reason:</strong> ${reason}</p>
                  ${additionalDetails ? `<p style="color: #374151; margin: 0;"><strong>Additional Details:</strong> ${additionalDetails}</p>` : ""}
                </div>
                
                <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <h2 style="color: #374151; font-size: 14px; margin: 0 0 12px; text-transform: uppercase;">Photo Information</h2>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280; width: 120px;">Report ID:</td>
                      <td style="padding: 4px 0; color: #111827;">${report.id}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Photo ID:</td>
                      <td style="padding: 4px 0; color: #111827;">${photoId}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Uploaded By:</td>
                      <td style="padding: 4px 0; color: #111827;">${uploaderName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Club:</td>
                      <td style="padding: 4px 0; color: #111827;">${clubName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Team:</td>
                      <td style="padding: 4px 0; color: #111827;">${teamName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Reported By:</td>
                      <td style="padding: 4px 0; color: #111827;">${reporterName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #6b7280;">Reported At:</td>
                      <td style="padding: 4px 0; color: #111827;">${new Date().toLocaleString("en-AU", { timeZone: "Australia/Adelaide" })}</td>
                    </tr>
                  </table>
                </div>
                
                ${photoUrl ? `
                <div style="margin-bottom: 20px;">
                  <h2 style="color: #374151; font-size: 14px; margin: 0 0 12px; text-transform: uppercase;">Reported Photo</h2>
                  <img src="${photoUrl}" alt="Reported photo" style="max-width: 100%; border-radius: 8px; border: 1px solid #e5e7eb;" />
                </div>
                ` : ""}
                
                <p style="color: #6b7280; font-size: 14px; margin: 20px 0 0; text-align: center;">
                  Please review this report in the admin dashboard.
                </p>
              </div>
              
              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  Ignite Club HQ • Photo Report System
                </p>
              </div>
            </div>
          </body>
          </html>
        `;

        const { error: emailError } = await resend.emails.send({
          from: "Ignite Club HQ <support@igniteclubhq.app>",
          to: ["privacy@igniteclubhq.app"],
          subject: `⚠️ Photo Report: ${reason} - ${clubName}`,
          html: emailHtml,
        });

        if (emailError) {
          console.error("Failed to send email:", emailError);
          // Don't fail the request if email fails - report is already in database
        } else {
          console.log("Report email sent successfully");
        }
      } catch (emailErr) {
        console.error("Email sending error:", emailErr);
        // Don't fail the request if email fails
      }
    } else {
      console.log("RESEND_API_KEY not configured, skipping email notification");
    }

    return new Response(
      JSON.stringify({ success: true, reportId: report.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-photo-report-email:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
