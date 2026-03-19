import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";

// Reminder interval in days
const REMINDER_INTERVAL_DAYS = 3;
// Maximum number of reminders to send
const MAX_REMINDERS = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting invite reminder check...");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
        metadata,
        teams:team_id (
          id,
          name,
          logo_url,
          club_id,
          clubs:club_id (
            id,
            name,
            logo_url,
            contact_email
          )
        ),
        clubs:club_id (
          id,
          name,
          logo_url,
          contact_email
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
      // Must have an email to send a reminder
      if (!invite.invited_email) return false;
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
        const clubContactEmail = team?.clubs?.contact_email || directClub?.contact_email;
        
        const recipientName = invite.invited_label || invite.invited_email?.split("@")[0] || "Member";
        const roleName = invite.role || "Member";
        const reminderNumber = (invite.reminder_count || 0) + 1;

        // Extract children names from metadata for parent invites
        const metadata = invite.metadata as { children?: { name: string }[]; customMessage?: string } | null;
        const childrenNames = invite.role === "parent" && metadata?.children
          ? metadata.children.map((c: { name: string }) => c.name)
          : undefined;

        // Build the invite link using the personal token
        const inviteLink = invite.invite_token
          ? `https://igniteclubhq.app/join/p/${invite.invite_token}`
          : `https://igniteclubhq.app`;

        console.log(`Sending reminder #${reminderNumber} to ${invite.invited_email} for ${teamName}`);

        // Route through the send-email function for correct template selection
        // (new user → team-invite template, existing parent → child-added template)
        const { error: emailError } = await supabase.functions.invoke("send-email", {
          body: {
            to: invite.invited_email,
             subject: childrenNames && childrenNames.length === 1
               ? `Reminder: ${clubName} — see which team ${childrenNames[0]} is in ⚽`
               : childrenNames && childrenNames.length > 1
                 ? `Reminder: ${clubName} — see which team your kids are in ⚽`
                 : `Reminder: ${clubName} — you've been added to the team ⚽`,
            template: "team-invite",
            senderName: clubName !== "Your Club" ? clubName : undefined,
            replyTo: clubContactEmail,
            templateData: {
              recipientName,
              invitedEmail: invite.invited_email,
              teamName,
              clubName,
              roleName: roleName.charAt(0).toUpperCase() + roleName.slice(1).replace("_", " "),
              inviteLink,
              clubLogoUrl,
              childrenNames,
              customMessage: metadata?.customMessage,
            },
          },
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
