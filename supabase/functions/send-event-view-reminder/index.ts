import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "npm:resend@4.0.0";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import * as React from "npm:react@18.3.1";
import { EventViewReminderEmail } from "./_templates/event-view-reminder.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  eventId: string;
  userIds: string[]; // Users who haven't viewed the event
  channels?: "push" | "email" | "both"; // Delivery channel selection
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the request is from an authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: requestingUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !requestingUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { eventId, userIds, channels = "both" } = await req.json() as RequestBody;

    if (!eventId || !userIds || userIds.length === 0) {
      return new Response(JSON.stringify({ error: "Missing eventId or userIds" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch event details
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select(`
        id, title, event_date, type, address, suburb, start_time,
        team_id, club_id, mini_league_id,
        teams (name),
        clubs (name, logo_url)
      `)
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if club/team has Pro subscription (Pro only feature)
    let hasPro = false;
    
    if (event.team_id) {
      const { data: teamSub } = await supabase
        .from("team_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("team_id", event.team_id)
        .maybeSingle();
      
      if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) {
        hasPro = true;
      }
    }
    
    if (!hasPro && event.club_id) {
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", event.club_id)
        .maybeSingle();
      
      if (clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override) {
        hasPro = true;
      }
    }

    if (!hasPro) {
      return new Response(JSON.stringify({ error: "This feature requires a Pro subscription" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify requesting user is admin for this event
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .or(`role.eq.app_admin,and(club_id.eq.${event.club_id},role.in.(club_admin,team_admin,coach,league_admin,committee_member))${event.team_id ? `,and(team_id.eq.${event.team_id},role.in.(team_admin,coach))` : ""}`)
      .limit(1);

    if (!adminRole || adminRole.length === 0) {
      return new Response(JSON.stringify({ error: "Not authorized to send reminders for this event" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user profiles and emails in parallel (targeted, not listUsers)
    const [profilesResult, ...userResults] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds),
      ...userIds.map(id => supabase.auth.admin.getUserById(id)),
    ]);

    const profiles = profilesResult.data;

    const userEmailMap = new Map<string, string>();
    userResults.forEach((result, index) => {
      const userId = userIds[index];
      if (result.data?.user?.email) {
        userEmailMap.set(userId, result.data.user.email);
      }
    });

    const profileMap = new Map<string, string>();
    profiles?.forEach(p => {
      profileMap.set(p.id, p.display_name || "Member");
    });

    // Format event details
    const eventDate = new Date(event.event_date).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const eventTime = event.start_time
      ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString("en-AU", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "TBC";
    const eventLocation = event.suburb || event.address || undefined;
    const teamName = (event.teams as any)?.name || "Your Team";
    const clubName = (event.clubs as any)?.name || "Your Club";
    const clubLogoUrl = (event.clubs as any)?.logo_url || undefined;
    const eventLink = `https://igniteclubhq.app/events/${event.id}`;

    // Smart copy based on event type
    const isRsvpEvent = ["game", "training", "match"].includes(event.type?.toLowerCase());
    const emailSubject = isRsvpEvent
      ? `📅 Reminder: Please RSVP to "${event.title}"`
      : `🎉 Don't miss: "${event.title}" - ${eventDate}`;
    const pushTitle = isRsvpEvent ? "📅 Event Reminder" : `🎉 ${event.title}`;
    const pushBody = isRsvpEvent
      ? `You haven't RSVP'd to "${event.title}" - tap to respond`
      : `Don't miss "${event.title}" on ${eventDate} - tap for details`;
    const notifMessage = isRsvpEvent
      ? `Reminder: Please RSVP to "${event.title}" - ${eventDate}`
      : `Don't miss: "${event.title}" - ${eventDate}`;

    let emailsSent = 0;
    let pushSent = 0;

    const sendEmail = channels === "email" || channels === "both";
    const sendPush = channels === "push" || channels === "both";

    // Send emails in parallel batches if Resend is configured
    if (sendEmail && resendApiKey) {
      const resend = new Resend(resendApiKey);

      // Pre-render the template once per user in parallel
      const emailPromises = userIds.map(async (userId) => {
        const email = userEmailMap.get(userId);
        const name = profileMap.get(userId) || "Member";
        if (!email) return false;

        try {
          const html = await renderAsync(
            React.createElement(EventViewReminderEmail, {
              recipientName: name,
              eventTitle: event.title,
              teamName,
              clubName,
              eventDate,
              eventTime,
              eventLocation,
              eventType: event.type.charAt(0).toUpperCase() + event.type.slice(1),
              eventLink,
              clubLogoUrl,
            })
          );

          await resend.emails.send({
            from: "Ignite Club HQ <support@igniteclubhq.app>",
            to: [email],
            subject: emailSubject,
            html,
          });
          return true;
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          return false;
        }
      });

      const emailResults = await Promise.all(emailPromises);
      emailsSent = emailResults.filter(Boolean).length;
    }

    // Send push notifications in parallel
    if (sendPush) {
      const pushPromises = userIds.map(async (userId) => {
        try {
          // Insert notification and check for push subscriptions AND FCM tokens in parallel
          const [, { data: webSubscriptions }, { data: fcmTokens }] = await Promise.all([
            supabase.from("notifications").insert({
              user_id: userId,
              type: "event_view_reminder",
              message: notifMessage,
              related_id: event.id,
            }),
            supabase
              .from("push_subscriptions")
              .select("id")
              .eq("user_id", userId)
              .limit(1),
            supabase
              .from("fcm_tokens")
              .select("id")
              .eq("user_id", userId)
              .limit(1),
          ]);

          const hasWebPush = webSubscriptions && webSubscriptions.length > 0;
          const hasFcm = fcmTokens && fcmTokens.length > 0;

          if (hasWebPush || hasFcm) {
            await supabase.functions.invoke("send-push-notification", {
              body: {
                userId,
                title: pushTitle,
                body: pushBody,
                url: `/events/${event.id}`,
                tag: `event-view-${event.id}`,
              },
            });
            return true;
          }
          return false;
        } catch (pushError) {
          console.error(`Failed to send push to ${userId}:`, pushError);
          return false;
        }
      });

      const pushResults = await Promise.all(pushPromises);
      pushSent = pushResults.filter(Boolean).length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailsSent,
        pushSent,
        totalUsers: userIds.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-event-view-reminder:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
