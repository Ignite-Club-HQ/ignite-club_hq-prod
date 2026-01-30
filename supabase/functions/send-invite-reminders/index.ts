import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Reminder interval in days
const REMINDER_INTERVAL_DAYS = 3;
// Maximum number of reminders to send
const MAX_REMINDERS = 5;

// Production domain for all links
const PRODUCTION_DOMAIN = "https://igniteclubhq.app";
const IGNITE_BRAND_COLOR = "#10b981";
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-email-icon.png`;

// Check if URL is valid
const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

// Normalize invite link
const normalizeInviteLink = (link: string): string => {
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}`;
  } catch {
    if (link.startsWith('/')) return `${PRODUCTION_DOMAIN}${link}`;
    return link;
  }
};

// Generate HTML email template
const generateEmailHtml = ({
  recipientName,
  teamName,
  clubName,
  roleName,
  inviteLink,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  reminderNumber = 1,
}: {
  recipientName: string;
  teamName: string;
  clubName: string;
  roleName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  reminderNumber?: number;
}): string => {
  const normalizedInviteLink = normalizeInviteLink(inviteLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;

  const logoHtml = validClubLogoUrl
    ? `<img src="${validClubLogoUrl}" width="80" height="80" alt="${clubName}" style="margin: 0 auto; border-radius: 12px; object-fit: cover; display: block;" />`
    : `<div style="width: 80px; height: 80px; border-radius: 12px; margin: 0 auto; background-color: ${primaryColor}; display: flex; align-items: center; justify-content: center;">
        <span style="color: #ffffff; font-size: 36px; font-weight: bold; line-height: 80px; text-align: center; display: block; width: 100%;">${clubName.charAt(0).toUpperCase()}</span>
      </div>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reminder: Join ${teamName}</title>
</head>
<body style="background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif; margin: 0; padding: 20px;">
  <div style="background-color: #ffffff; margin: 0 auto; padding: 0; margin-bottom: 40px; border-radius: 12px; overflow: hidden; max-width: 560px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">
    
    <!-- Header with Logo -->
    <div style="background-color: #fafafa; padding: 32px 40px; text-align: center;">
      ${logoHtml}
      <p style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin: 16px 0 0 0;">${clubName}</p>
    </div>

    <hr style="border: none; border-top: 1px solid #e6e6e6; margin: 0;" />

    <!-- Main Content -->
    <div style="padding: 32px 40px;">
      <h1 style="color: #1a1a1a; font-size: 28px; font-weight: bold; margin: 0 0 24px 0; text-align: center;">Friendly Reminder 👋</h1>
      
      <p style="color: #4a4a4a; font-size: 16px; line-height: 26px; margin: 0 0 16px 0;">
        Hi ${recipientName},
      </p>
      
      <p style="color: #4a4a4a; font-size: 16px; line-height: 26px; margin: 0 0 16px 0;">
        We noticed you haven't accepted your invitation to join <strong style="color: ${primaryColor};">${teamName}</strong> as a <strong>${roleName}</strong> yet.
      </p>

      <p style="color: #4a4a4a; font-size: 16px; line-height: 26px; margin: 0 0 16px 0;">
        Your spot is still waiting for you! Click the button below to complete your registration.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${normalizedInviteLink}" style="background-color: ${primaryColor}; border-radius: 8px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none; text-align: center; display: inline-block; padding: 14px 32px;">
          Accept Invitation
        </a>
      </div>

      <p style="color: #8898aa; font-size: 13px; text-align: center; margin: 24px 0 8px 0;">
        Or copy and paste this link into your browser:
      </p>
      <p style="font-size: 13px; text-align: center; margin: 0; word-break: break-all;">
        <a href="${normalizedInviteLink}" style="color: ${primaryColor};">${normalizedInviteLink}</a>
      </p>
    </div>

    <hr style="border: none; border-top: 1px solid #e6e6e6; margin: 0;" />

    <!-- Footer -->
    <div style="background-color: #fafafa; padding: 24px 40px;">
      <p style="color: #8898aa; font-size: 12px; line-height: 20px; margin: 0 0 12px 0; text-align: center;">
        This is reminder #${reminderNumber}. This invitation was sent by ${clubName}.
        You can manage your notification preferences in the app settings after joining.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr>
          <td style="padding-right: 8px; vertical-align: middle;">
            <img src="${IGNITE_ICON_URL}" width="24" height="24" alt="Ignite Club HQ" style="display: block; border-radius: 4px;" />
          </td>
          <td style="vertical-align: middle;">
            <a href="${PRODUCTION_DOMAIN}" style="color: ${IGNITE_BRAND_COLOR}; font-size: 12px; text-decoration: none;">
              Powered by Ignite Club HQ
            </a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>
`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting invite reminder check...");

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(RESEND_API_KEY);

    // Calculate the cutoff date (3 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - REMINDER_INTERVAL_DAYS);
    const cutoffDateStr = cutoffDate.toISOString();

    // Find pending invites that need reminders
    const { data: pendingInvites, error: fetchError } = await supabase
      .from("pending_invites")
      .select(`
        id,
        invited_email,
        invited_label,
        role,
        invite_token,
        reminder_count,
        created_at,
        last_reminder_sent_at,
        team_id,
        club_id,
        teams:team_id (
          id,
          name,
          logo_url,
          club_id,
          clubs:club_id (
            id,
            name,
            logo_url
          )
        ),
        clubs:club_id (
          id,
          name,
          logo_url
        )
      `)
      .eq("status", "pending")
      .lt("reminder_count", MAX_REMINDERS)
      .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${cutoffDateStr}`);

    if (fetchError) {
      console.error("Error fetching pending invites:", fetchError);
      throw fetchError;
    }

    console.log(`Found ${pendingInvites?.length || 0} pending invites to check`);

    // Filter to only include invites that are actually due for a reminder
    const invitesDueForReminder = (pendingInvites || []).filter((invite) => {
      // For first reminder, check if created_at is older than 3 days
      if (!invite.last_reminder_sent_at) {
        const createdAt = new Date(invite.created_at);
        return createdAt < cutoffDate;
      }
      return true;
    });

    console.log(`${invitesDueForReminder.length} invites due for reminder`);

    let sentCount = 0;
    let errorCount = 0;

    for (const invite of invitesDueForReminder) {
      try {
        const team = invite.teams as any;
        const directClub = invite.clubs as any;
        
        const teamName = team?.name || "the team";
        const clubName = team?.clubs?.name || directClub?.name || "Your Club";
        const clubLogoUrl = team?.clubs?.logo_url || directClub?.logo_url;
        
        const recipientName = invite.invited_label || invite.invited_email?.split("@")[0] || "Member";
        const roleName = invite.role || "Member";
        const reminderNumber = (invite.reminder_count || 0) + 1;
        const inviteLink = `https://igniteclubhq.app/join/${invite.invite_token}`;

        console.log(`Sending reminder #${reminderNumber} to ${invite.invited_email} for ${teamName}`);

        const html = generateEmailHtml({
          recipientName,
          teamName,
          clubName,
          roleName,
          inviteLink,
          clubLogoUrl,
          reminderNumber,
        });

        const { error: emailError } = await resend.emails.send({
          from: "Ignite Club HQ <support@igniteclubhq.app>",
          to: [invite.invited_email],
          replyTo: "support@igniteclubhq.app",
          subject: `Reminder: You're invited to join ${teamName}!`,
          html,
        });

        if (emailError) {
          console.error(`Failed to send reminder to ${invite.invited_email}:`, emailError);
          errorCount++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("pending_invites")
          .update({
            last_reminder_sent_at: new Date().toISOString(),
            reminder_count: reminderNumber,
          })
          .eq("id", invite.id);

        if (updateError) {
          console.error(`Failed to update invite ${invite.id}:`, updateError);
        }

        sentCount++;
        console.log(`Reminder sent successfully to ${invite.invited_email}`);

      } catch (inviteError) {
        console.error(`Error processing invite ${invite.id}:`, inviteError);
        errorCount++;
      }
    }

    const result = {
      success: true,
      message: `Processed ${invitesDueForReminder.length} invites. Sent ${sentCount} reminders, ${errorCount} errors.`,
      sentCount,
      errorCount,
      totalChecked: invitesDueForReminder.length,
    };

    console.log("Invite reminder check complete:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-invite-reminders:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
