import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Helper function to call the centralized send-email function
async function sendTemplateEmail(
  supabase: any,
  to: string,
  subject: string,
  template: string,
  templateData: Record<string, any>
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("send-email", {
      body: { to, subject, template, templateData },
    });
    
    if (error) {
      console.error(`Failed to send ${template} email to ${to}:`, error);
      return false;
    }
    
    console.log(`${template} email sent to ${to}`);
    return true;
  } catch (e) {
    console.error(`Error sending ${template} email to ${to}:`, e);
    return false;
  }
}

// Check if user has email notifications enabled for events
async function isEmailEventsEnabled(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("notification_preferences")
    .select("email_events_enabled")
    .eq("user_id", userId)
    .single();
  
  // Default to true if no preferences set
  return data?.email_events_enabled ?? true;
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
    const now = new Date();
    
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select(`
        id,
        title,
        event_date,
        start_time,
        location,
        location_name,
        address,
        reminder_hours_before,
        club_id,
        team_id,
        type,
        teams (
          name,
          clubs (
            name,
            logo_url
          )
        )
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

        // Calculate hours until event for urgency display
        const hoursUntilEvent = Math.round((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60));

        // Get all RSVPs for this event (these are the invited users)
        const { data: rsvps } = await supabase
          .from("rsvps")
          .select("user_id, status")
          .eq("event_id", event.id)
          .not("user_id", "is", null);

        // Only remind invited users (those with an RSVP record) who haven't responded "going"
        const nonRsvpMembers = (rsvps || [])
          .filter(r => r.status !== "going")
          .map(r => r.user_id)
          .filter((id, i, arr) => arr.indexOf(id) === i);

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
            console.log(`Created ${nonRsvpMembers.length} notifications for event ${event.title}`);
            totalReminders += nonRsvpMembers.length;
          }

          // Format event details for email
          const eventDateFormatted = eventDate.toLocaleDateString('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          let eventTime = "TBD";
          if (event.start_time) {
            const timeStr = String(event.start_time);
            const parsed = timeStr.includes("T") || timeStr.includes(" ")
              ? new Date(timeStr)
              : new Date(`2000-01-01T${timeStr}`);
            if (!isNaN(parsed.getTime())) {
              eventTime = parsed.toLocaleTimeString("en-AU", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              });
            }
          }
          const eventLocation = event.location_name || event.address || event.location || undefined;
          const teamName = event.teams?.name || "Your Team";
          const clubName = event.teams?.clubs?.name || "Your Club";
          const clubLogoUrl = event.teams?.clubs?.logo_url || undefined;
          const eventLink = `https://igniteclubhq.app/events/${event.id}`;

          // Get user emails and profiles
          const { data: userEmails, error: emailError } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: nonRsvpMembers });
          
          if (emailError) {
            console.error('Error fetching user emails:', emailError);
          } else if (userEmails && userEmails.length > 0) {
            console.log(`Sending ${userEmails.length} event reminder emails using template...`);
            
            // Get profiles for recipient names
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", nonRsvpMembers);
            
            const profileMap = new Map(profiles?.map(p => [p.id, p.display_name]) || []);
            
            for (const user of userEmails) {
              // Check if user has email events enabled
              const emailEnabled = await isEmailEventsEnabled(supabase, user.id);
              if (!emailEnabled) {
                console.log(`User ${user.id} has email_events_enabled=false, skipping email`);
                continue;
              }
              
              const recipientName = profileMap.get(user.id) || user.email.split("@")[0];
              
              await sendTemplateEmail(
                supabase,
                user.email,
                `Reminder: RSVP for ${event.title}`,
                "event-reminder",
                {
                  recipientName,
                  eventTitle: event.title,
                  teamName,
                  clubName,
                  eventDate: eventDateFormatted,
                  eventTime,
                  eventLocation,
                  eventType: event.type || "event",
                  eventLink,
                  clubLogoUrl,
                  hoursUntilEvent: hoursUntilEvent > 0 ? hoursUntilEvent : undefined,
                }
              );
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

    // ============================================
    // Early RSVP Points Reminder (4 days before event, Pro clubs only)
    // ============================================
    console.log("Checking for early RSVP points reminders (4 days before)...");

    const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    const threeDaysThreeHoursFromNow = new Date(now.getTime() + (3 * 24 + 23) * 60 * 60 * 1000);

    // Find events ~4 days away that haven't had points reminder sent
    const { data: pointsReminderEvents, error: pointsEventsError } = await supabase
      .from("events")
      .select(`
        id,
        title,
        event_date,
        club_id,
        team_id,
        type,
        teams (
          name,
          clubs (
            name,
            points_display_name
          )
        )
      `)
      .eq("points_reminder_sent", false)
      .eq("is_cancelled", false)
      .is("mini_league_id", null) // points reminders are team-event only
      .not("team_id", "is", null)
      .gte("event_date", threeDaysThreeHoursFromNow.toISOString())
      .lte("event_date", fourDaysFromNow.toISOString());

    if (pointsEventsError) {
      console.error("Error fetching events for points reminder:", pointsEventsError);
    } else {
      console.log(`Found ${pointsReminderEvents?.length || 0} events eligible for points reminder`);

      for (const event of pointsReminderEvents || []) {
        // Check if club has Pro subscription with points enabled
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, disable_points_system")
          .eq("club_id", event.club_id)
          .maybeSingle();

        const hasPro = clubSub?.is_pro || clubSub?.is_pro_football ||
                       clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;

        if (!hasPro || clubSub?.disable_points_system) {
          // Mark as sent so we don't re-check non-Pro events
          await supabase.from("events").update({ points_reminder_sent: true }).eq("id", event.id);
          continue;
        }

        const pointsName = (event.teams?.clubs as any)?.points_display_name || 'reward points';
        const clubName = event.teams?.clubs?.name || "Your Club";

        // Get users who haven't RSVP'd "going"
        const { data: rsvps } = await supabase
          .from("rsvps")
          .select("user_id, status")
          .eq("event_id", event.id)
          .not("user_id", "is", null);

        const nonGoingUsers = (rsvps || [])
          .filter(r => r.status !== "going")
          .map(r => r.user_id)
          .filter((id, i, arr) => arr.indexOf(id) === i);

        if (nonGoingUsers.length > 0) {
          const hoursLeft = Math.round((new Date(event.event_date).getTime() - now.getTime() - 3 * 24 * 60 * 60 * 1000) / (1000 * 60 * 60));
          const timeText = hoursLeft > 1 ? `${hoursLeft} hours` : "1 hour";

          const notifications = nonGoingUsers.map(userId => ({
            user_id: userId,
            type: "early_rsvp_points" as const,
            message: `🎯 RSVP to "${event.title}" within the next ${timeText} to earn 3 ${pointsName}!`,
            related_id: event.id,
          }));

          const { error: notifError } = await supabase
            .from("notifications")
            .insert(notifications);

          if (notifError) {
            console.error(`Error creating points reminder notifications for event ${event.id}:`, notifError);
          } else {
            console.log(`Sent ${nonGoingUsers.length} early RSVP points reminders for "${event.title}" (${clubName})`);
            totalReminders += nonGoingUsers.length;
          }
        }

        // Mark points reminder as sent
        await supabase.from("events").update({ points_reminder_sent: true }).eq("id", event.id);
      }
    }

    // ============================================
    // Send 24-hour duty reminders for upcoming events
    // ============================================
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
        start_time,
        location,
        location_name,
        address,
        type,
        teams (
          name,
          clubs (
            name,
            logo_url
          )
        ),
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
        const eventDate = new Date(event.event_date);
        
        const eventDateFormatted = eventDate.toLocaleDateString('en-AU', {
          weekday: 'long',
          day: 'numeric', 
          month: 'long',
          year: 'numeric'
        });

        let eventTime = "TBD";
        if (event.start_time) {
          const timeStr = String(event.start_time);
          const parsed = timeStr.includes("T") || timeStr.includes(" ")
            ? new Date(timeStr)
            : new Date(`2000-01-01T${timeStr}`);
          if (!isNaN(parsed.getTime())) {
            eventTime = parsed.toLocaleTimeString("en-AU", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          }
        }
        const eventLocation = event.location_name || event.address || event.location || undefined;
        const teamName = event.teams?.name || "Your Team";
        const clubName = event.teams?.clubs?.name || "Your Club";
        const clubLogoUrl = event.teams?.clubs?.logo_url || undefined;
        const eventLink = `https://igniteclubhq.app/events/${event.id}`;
        
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
                console.log(`Created duty reminder notification for ${duty.assigned_to}`);
                totalReminders++;

                // Get user email and profile for duty reminder
                const { data: dutyUserEmails } = await supabase
                  .rpc('get_user_emails_by_ids', { user_ids: [duty.assigned_to] });

                if (dutyUserEmails && dutyUserEmails.length > 0) {
                  // Check if user has email events enabled
                  const emailEnabled = await isEmailEventsEnabled(supabase, duty.assigned_to);
                  if (!emailEnabled) {
                    console.log(`User ${duty.assigned_to} has email_events_enabled=false, skipping duty email`);
                    continue;
                  }
                  
                  const { data: profile } = await supabase
                    .from("profiles")
                    .select("display_name")
                    .eq("id", duty.assigned_to)
                    .single();
                  
                  const recipientName = profile?.display_name || dutyUserEmails[0].email.split("@")[0];
                  
                  // Use event-reminder template with duty info in title
                  await sendTemplateEmail(
                    supabase,
                    dutyUserEmails[0].email,
                    `Duty Reminder: ${duty.name} for ${event.title}`,
                    "event-reminder",
                    {
                      recipientName,
                      eventTitle: `${duty.name} - ${event.title}`,
                      teamName,
                      clubName,
                      eventDate: eventDateFormatted,
                      eventTime,
                      eventLocation,
                      eventType: "duty",
                      eventLink,
                      clubLogoUrl,
                      hoursUntilEvent: 24,
                    }
                  );
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
