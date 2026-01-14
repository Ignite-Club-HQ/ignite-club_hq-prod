import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from "resend";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Email template for renewal reminders
function renewalReminderEmail(entityName: string, tierName: string, expiryDate: string, entityType: 'team' | 'club'): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
        .info-box { background: #ecfdf5; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0; }
        .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔄 Subscription Renewal</h1>
        </div>
        <div class="content">
          <h2>Heads up!</h2>
          <div class="info-box">
            <p><strong>${entityName}</strong>'s <strong>${tierName}</strong> subscription will automatically renew on <strong>${expiryDate}</strong>.</p>
          </div>
          <p>If you'd like to cancel or make changes, please visit your ${entityType} settings before the renewal date.</p>
          <a href="https://igniteclubhq.com/${entityType}s" class="button">Manage Subscription</a>
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate cron secret
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = Deno.env.get('CRON_SECRET');
  
  if (!cronSecret || cronSecret !== expectedSecret) {
    console.error('Unauthorized: Invalid or missing cron secret');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate the date range for 7 days from now (with some buffer for daily cron)
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const eightDaysFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    let teamReminders = 0;
    let clubReminders = 0;

    // ==========================================
    // TEAM SUBSCRIPTIONS - Annual reminders
    // ==========================================
    const { data: teamSubs, error: teamError } = await supabase
      .from('team_subscriptions')
      .select('id, team_id, is_pro, is_pro_football, expires_at')
      .gte('expires_at', sevenDaysFromNow.toISOString())
      .lt('expires_at', eightDaysFromNow.toISOString())
      .or('is_pro.eq.true,is_pro_football.eq.true');

    if (teamError) {
      console.error('Error fetching team subscriptions:', teamError);
      throw teamError;
    }

    if (teamSubs && teamSubs.length > 0) {
      console.log(`Found ${teamSubs.length} team subscriptions expiring in 7 days`);

      for (const sub of teamSubs) {
        // Check if reminder already sent (avoid duplicate notifications)
        const { data: existingNotif } = await supabase
          .from('notifications')
          .select('id')
          .eq('related_id', sub.team_id)
          .eq('type', 'subscription_renewal_reminder')
          .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existingNotif && existingNotif.length > 0) {
          console.log(`Reminder already sent for team ${sub.team_id}, skipping`);
          continue;
        }

        // Get team admins
        const { data: teamAdmins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', sub.team_id)
          .in('role', ['team_admin', 'coach']);

        if (teamAdmins && teamAdmins.length > 0) {
          const { data: team } = await supabase
            .from('teams')
            .select('name')
            .eq('id', sub.team_id)
            .single();

          const teamName = team?.name || 'Your team';
          const tierName = sub.is_pro_football ? 'Pro Football' : 'Pro';
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          const notifications = teamAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_renewal_reminder',
            message: `${teamName}'s ${tierName} subscription will renew on ${expiryDate}. To cancel, visit the team settings.`,
            related_id: sub.team_id,
          }));

          await supabase.from('notifications').insert(notifications);
          teamReminders++;

          // Send emails to team admins
          const adminIds = teamAdmins.map(a => a.user_id);
          const { data: adminEmails } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: adminIds });

          if (adminEmails && adminEmails.length > 0) {
            for (const admin of adminEmails) {
              try {
                await sendEmail(
                  admin.email,
                  `Subscription Renewal: ${teamName}`,
                  renewalReminderEmail(teamName, tierName, expiryDate, 'team')
                );
              } catch (e) {
                console.error(`Failed to send renewal email:`, e);
              }
            }
          }
        }
      }
    }

    // ==========================================
    // CLUB SUBSCRIPTIONS - Annual reminders
    // ==========================================
    const { data: clubSubs, error: clubError } = await supabase
      .from('club_subscriptions')
      .select('id, club_id, is_pro, is_pro_football, expires_at')
      .gte('expires_at', sevenDaysFromNow.toISOString())
      .lt('expires_at', eightDaysFromNow.toISOString())
      .or('is_pro.eq.true,is_pro_football.eq.true');

    if (clubError) {
      console.error('Error fetching club subscriptions:', clubError);
      throw clubError;
    }

    if (clubSubs && clubSubs.length > 0) {
      console.log(`Found ${clubSubs.length} club subscriptions expiring in 7 days`);

      for (const sub of clubSubs) {
        // Check if reminder already sent
        const { data: existingNotif } = await supabase
          .from('notifications')
          .select('id')
          .eq('related_id', sub.club_id)
          .eq('type', 'subscription_renewal_reminder')
          .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existingNotif && existingNotif.length > 0) {
          console.log(`Reminder already sent for club ${sub.club_id}, skipping`);
          continue;
        }

        // Get club admins
        const { data: clubAdmins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('club_id', sub.club_id)
          .eq('role', 'club_admin');

        if (clubAdmins && clubAdmins.length > 0) {
          const { data: club } = await supabase
            .from('clubs')
            .select('name')
            .eq('id', sub.club_id)
            .single();

          const clubName = club?.name || 'Your club';
          const tierName = sub.is_pro_football ? 'Club Pro Football' : 'Club Pro';
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          const notifications = clubAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_renewal_reminder',
            message: `${clubName}'s ${tierName} subscription will renew on ${expiryDate}. To cancel, visit the club settings.`,
            related_id: sub.club_id,
          }));

          await supabase.from('notifications').insert(notifications);
          clubReminders++;

          // Send emails to club admins
          const adminIds = clubAdmins.map(a => a.user_id);
          const { data: adminEmails } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: adminIds });

          if (adminEmails && adminEmails.length > 0) {
            for (const admin of adminEmails) {
              try {
                await sendEmail(
                  admin.email,
                  `Subscription Renewal: ${clubName}`,
                  renewalReminderEmail(clubName, tierName, expiryDate, 'club')
                );
              } catch (e) {
                console.error(`Failed to send renewal email:`, e);
              }
            }
          }
        }
      }
    }

    console.log(`Sent ${teamReminders} team reminders and ${clubReminders} club reminders`);

    return new Response(
      JSON.stringify({
        message: 'Renewal reminders sent',
        teamReminders,
        clubReminders,
        total: teamReminders + clubReminders
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in send-renewal-reminders:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
