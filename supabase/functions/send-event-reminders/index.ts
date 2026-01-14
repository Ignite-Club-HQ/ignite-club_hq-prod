import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "resend";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Email templates
function eventReminderEmail(eventTitle: string, eventDate: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f97316, #ea580c); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
        .button { display: inline-block; background: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔥 Event Reminder</h1>
        </div>
        <div class="content">
          <h2>Don't forget to RSVP!</h2>
          <p>You haven't responded to <strong>${eventTitle}</strong> yet.</p>
          <p><strong>📅 Date:</strong> ${eventDate}</p>
          <p>Please let your team know if you can make it!</p>
          <a href="https://igniteclubhq.com/events" class="button">View Event</a>
        </div>
        <div class="footer">
          <p>Ignite Club HQ - Team Management Made Easy</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function dutyReminderEmail(dutyName: string, eventTitle: string, eventDate: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
        .highlight { background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0; }
        .button { display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📋 Duty Reminder</h1>
        </div>
        <div class="content">
          <h2>You have a duty tomorrow!</h2>
          <div class="highlight">
            <p><strong>🎯 Duty:</strong> ${dutyName}</p>
            <p><strong>📅 Event:</strong> ${eventTitle}</p>
            <p><strong>🕐 Date:</strong> ${eventDate}</p>
          </div>
          <p>Please make sure you're prepared for your duty!</p>
          <a href="https://igniteclubhq.com/events" class="button">View Details</a>
        </div>
        <div class="footer">
          <p>Ignite Club HQ - Team Management Made Easy</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await resend.emails.send({
      from: "Ignite Club HQ <contact@igniteclubhq.app>",
      to: [to],
      subject,
      html,
    });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate cron secret for security
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  
  if (!cronSecret || cronSecret !== expectedSecret) {
    console.error("Unauthorized: Invalid or missing cron secret");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Checking for events needing reminders...");

    // Find events that need reminders sent
    // Events where: event_date - reminder_hours_before <= now AND reminder_sent = false AND not cancelled
    const now = new Date();
    
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select(`
        id,
        title,
        event_date,
        reminder_hours_before,
        club_id,
        team_id
      `)
      .eq("reminder_sent", false)
      .eq("is_cancelled", false)
      .not("reminder_hours_before", "is", null);

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      throw eventsError;
    }

    console.log(`Found ${events?.length || 0} events with reminder settings`);

    let totalReminders = 0;

    for (const event of events || []) {
      const eventDate = new Date(event.event_date);
      const reminderTime = new Date(eventDate.getTime() - (event.reminder_hours_before * 60 * 60 * 1000));
      
      // Check if it's time to send the reminder
      if (now >= reminderTime) {
        console.log(`Sending reminders for event: ${event.title}`);

        // Get all RSVPs for this event
        const { data: rsvps } = await supabase
          .from("rsvps")
          .select("user_id")
          .eq("event_id", event.id);

        const rsvpUserIds = rsvps?.map(r => r.user_id) || [];

        // Get all members who should RSVP
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }

        const { data: members } = await memberQuery;
        const allMemberIds = [...new Set(members?.map(m => m.user_id) || [])];

        // Find members who haven't RSVPed
        const nonRsvpMembers = allMemberIds.filter(id => !rsvpUserIds.includes(id));

        if (nonRsvpMembers.length > 0) {
          // Create notifications
          const notifications = nonRsvpMembers.map(userId => ({
            user_id: userId,
            type: "event_reminder",
            message: `Reminder: Please RSVP for "${event.title}" happening soon!`,
            related_id: event.id,
          }));

          const { error: notifError } = await supabase
            .from("notifications")
            .insert(notifications);

          if (notifError) {
            console.error(`Error creating notifications for event ${event.id}:`, notifError);
          } else {
            console.log(`Sent ${nonRsvpMembers.length} reminders for event ${event.title}`);
            totalReminders += nonRsvpMembers.length;
          }

          // Send emails to non-RSVPed members
          const eventDateFormatted = new Date(event.event_date).toLocaleDateString('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          // Get user emails using our secure function
          const { data: userEmails, error: emailError } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: nonRsvpMembers });
          
          if (emailError) {
            console.error('Error fetching user emails:', emailError);
          } else if (userEmails && userEmails.length > 0) {
            console.log(`Sending ${userEmails.length} event reminder emails...`);
            
            for (const user of userEmails) {
              try {
                await sendEmail(
                  user.email,
                  `Reminder: RSVP for ${event.title}`,
                  eventReminderEmail(event.title, eventDateFormatted)
                );
              } catch (e) {
                console.error(`Failed to send email to ${user.email}:`, e);
              }
            }
          }
        }

        // Mark reminder as sent
        const { error: updateError } = await supabase
          .from("events")
          .update({ reminder_sent: true })
          .eq("id", event.id);

        if (updateError) {
          console.error(`Error updating reminder_sent for event ${event.id}:`, updateError);
        }
      }
    }

    // Send 24-hour duty reminders for upcoming events
    console.log("Checking for duty reminders (24 hours before event)...");
    
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const twentyThreeHoursFromNow = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    
    // Find events happening in ~24 hours that have duties assigned
    const { data: upcomingEventsWithDuties, error: dutyEventsError } = await supabase
      .from("events")
      .select(`
        id,
        title,
        event_date,
        duties!inner (
          id,
          assigned_to,
          name
        )
      `)
      .eq("is_cancelled", false)
      .gte("event_date", twentyThreeHoursFromNow.toISOString())
      .lte("event_date", twentyFourHoursFromNow.toISOString());

    if (dutyEventsError) {
      console.error("Error fetching events with duties:", dutyEventsError);
    } else {
      console.log(`Found ${upcomingEventsWithDuties?.length || 0} events with duties in ~24 hours`);

      for (const event of upcomingEventsWithDuties || []) {
        const duties = (event as any).duties || [];
        
        for (const duty of duties) {
          if (duty.assigned_to) {
            // Check if we already sent a duty reminder for this duty
            const { data: existingReminder } = await supabase
              .from("notifications")
              .select("id")
              .eq("user_id", duty.assigned_to)
              .eq("type", "duty_reminder")
              .eq("related_id", event.id)
              .maybeSingle();
            
            if (!existingReminder) {
              const { error: dutyNotifError } = await supabase
                .from("notifications")
                .insert({
                  user_id: duty.assigned_to,
                  type: "duty_reminder",
                  message: `Reminder: You have "${duty.name}" duty for "${event.title}" tomorrow!`,
                  related_id: event.id,
                });

              if (dutyNotifError) {
                console.error(`Error creating duty reminder for duty ${duty.id}:`, dutyNotifError);
              } else {
                console.log(`Sent duty reminder to ${duty.assigned_to} for ${duty.name}`);
                totalReminders++;

                // Send duty reminder email
                const eventDateFormatted = new Date(event.event_date).toLocaleDateString('en-AU', {
                  weekday: 'long',
                  day: 'numeric', 
                  month: 'long',
                  year: 'numeric'
                });

                const { data: dutyUserEmails } = await supabase
                  .rpc('get_user_emails_by_ids', { user_ids: [duty.assigned_to] });

                if (dutyUserEmails && dutyUserEmails.length > 0) {
                  try {
                    await sendEmail(
                      dutyUserEmails[0].email,
                      `Duty Reminder: ${duty.name} for ${event.title}`,
                      dutyReminderEmail(duty.name, event.title, eventDateFormatted)
                    );
                  } catch (e) {
                    console.error(`Failed to send duty email:`, e);
                  }
                }
              }
            }
          }
        }
      }
    }

    console.log(`Total reminders sent: ${totalReminders}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${events?.length || 0} events, sent ${totalReminders} reminders` 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-event-reminders:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
