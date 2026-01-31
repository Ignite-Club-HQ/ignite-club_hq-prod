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

    const { eventId, userIds } = await req.json() as RequestBody;

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

    // Verify requesting user is admin for this event
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .or(`role.eq.app_admin,and(club_id.eq.${event.club_id},role.in.(club_admin,team_admin,coach,league_admin))${event.team_id ? `,and(team_id.eq.${event.team_id},role.in.(team_admin,coach))` : ""}`)
      .limit(1);

    if (!adminRole || adminRole.length === 0) {
      return new Response(JSON.stringify({ error: "Not authorized to send reminders for this event" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user profiles and emails
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    // Get emails from auth.users (we need service role for this)
    const { data: { users: authUsers }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) {
      console.error("Error fetching users:", usersError);
    }

    const userEmailMap = new Map<string, string>();
    authUsers?.forEach(u => {
      if (u.email && userIds.includes(u.id)) {
        userEmailMap.set(u.id, u.email);
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

    let emailsSent = 0;
    let pushSent = 0;

    // Send emails if Resend is configured
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);

      for (const userId of userIds) {
        const email = userEmailMap.get(userId);
        const name = profileMap.get(userId) || "Member";

        if (email) {
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
              subject: `📅 Reminder: You haven't viewed "${event.title}"`,
              html,
            });
            emailsSent++;
          } catch (emailError) {
            console.error(`Failed to send email to ${email}:`, emailError);
          }
        }
      }
    }

    // Send push notifications
    for (const userId of userIds) {
      try {
        // Insert notification
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "event_view_reminder",
          message: `Reminder: Please check "${event.title}" - ${eventDate}`,
          related_id: event.id,
        });

        // Try to send push notification
        const { data: subscriptions } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", userId);

        if (subscriptions && subscriptions.length > 0) {
          // Call push notification function
          await supabase.functions.invoke("send-push-notification", {
            body: {
              userId,
              title: "📅 Event Reminder",
              body: `You haven't viewed "${event.title}" - tap to see details`,
              url: `/events/${event.id}`,
              tag: `event-view-${event.id}`,
            },
          });
          pushSent++;
        }
      } catch (pushError) {
        console.error(`Failed to send push to ${userId}:`, pushError);
      }
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