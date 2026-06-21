import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Helper function to call the centralized send-email function
async function sendTemplateEmail(
  supabase: any,
  to: string,
  subject: string,
  template: string,
  templateData: any
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("send-email", {
      body: { to, subject, template, templateData },
    });
    if (error) {
      console.error(`Failed to send ${template} email to ${to}:`, error);
      return false;
    }
    console.log(`Sent ${template} email to ${to}`);
    return true;
  } catch (e) {
    console.error(`Exception sending ${template} email to ${to}:`, e);
    return false;
  }
}

// Check if user has email admin notifications enabled
async function isEmailAdminEnabled(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("notification_preferences")
    .select("email_admin_enabled")
    .eq("user_id", userId)
    .single();
  
  // Default to true if no preferences set
  return data?.email_admin_enabled ?? true;
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
          // Get team details with club info
          const { data: team } = await supabase
            .from('teams')
            .select('name, club_id, clubs!club_id(name, logo_url)')
            .eq('id', sub.team_id)
            .single();

          const teamName = team?.name || 'Your team';
          const clubName = team?.clubs?.name || '';
          const clubLogoUrl = team?.clubs?.logo_url || undefined;
          const tierName = sub.is_pro_football ? 'Pro Football' : 'Pro';
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          // Calculate days until expiry
          const daysUntilExpiry = Math.ceil((new Date(sub.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

          const notifications = teamAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_renewal_reminder',
            message: `${teamName}'s ${tierName} subscription will renew on ${expiryDate}. To cancel, visit the team settings.`,
            related_id: sub.team_id,
          }));

          await supabase.from('notifications').insert(notifications);
          teamReminders++;

          // Send emails to team admins using the new template
          const adminIds = teamAdmins.map(a => a.user_id);
          const { data: adminEmails } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: adminIds });

          // Get admin profiles for personalized greeting
          const { data: adminProfiles } = await supabase
            .from('profiles')
            .select('id, display_name')
            .in('id', adminIds);

          const profileMap = new Map(adminProfiles?.map(p => [p.id, p.display_name]) || []);

          if (adminEmails && adminEmails.length > 0) {
            for (const admin of adminEmails) {
              // Check if user has email admin notifications enabled
              const emailEnabled = await isEmailAdminEnabled(supabase, admin.user_id);
              if (!emailEnabled) {
                console.log(`User ${admin.user_id} has email_admin_enabled=false, skipping renewal email`);
                continue;
              }
              
              const recipientName = profileMap.get(admin.user_id) || undefined;
              
              await sendTemplateEmail(
                supabase,
                admin.email,
                `Subscription Renewal: ${teamName}`,
                'renewal-reminder',
                {
                  recipientName,
                  entityName: teamName,
                  entityType: 'team',
                  tierName,
                  expiryDate,
                  daysUntilExpiry,
                  manageLink: `https://igniteclubhq.app/team/${sub.team_id}`,
                  clubLogoUrl,
                  primaryColor: '#10b981',
                }
              );
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
            .select('name, logo_url')
            .eq('id', sub.club_id)
            .single();

          const clubName = club?.name || 'Your club';
          const clubLogoUrl = club?.logo_url || undefined;
          const tierName = sub.is_pro_football ? 'Club Pro Football' : 'Club Pro';
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          // Calculate days until expiry
          const daysUntilExpiry = Math.ceil((new Date(sub.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

          const notifications = clubAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_renewal_reminder',
            message: `${clubName}'s ${tierName} subscription will renew on ${expiryDate}. To cancel, visit the club settings.`,
            related_id: sub.club_id,
          }));

          await supabase.from('notifications').insert(notifications);
          clubReminders++;

          // Send emails to club admins using the new template
          const adminIds = clubAdmins.map(a => a.user_id);
          const { data: adminEmails } = await supabase
            .rpc('get_user_emails_by_ids', { user_ids: adminIds });

          // Get admin profiles for personalized greeting
          const { data: adminProfiles } = await supabase
            .from('profiles')
            .select('id, display_name')
            .in('id', adminIds);

          const profileMap = new Map(adminProfiles?.map(p => [p.id, p.display_name]) || []);

          if (adminEmails && adminEmails.length > 0) {
            for (const admin of adminEmails) {
              // Check if user has email admin notifications enabled
              const emailEnabled = await isEmailAdminEnabled(supabase, admin.user_id);
              if (!emailEnabled) {
                console.log(`User ${admin.user_id} has email_admin_enabled=false, skipping renewal email`);
                continue;
              }
              
              const recipientName = profileMap.get(admin.user_id) || undefined;
              
              await sendTemplateEmail(
                supabase,
                admin.email,
                `Subscription Renewal: ${clubName}`,
                'renewal-reminder',
                {
                  recipientName,
                  entityName: clubName,
                  entityType: 'club',
                  tierName,
                  expiryDate,
                  daysUntilExpiry,
                  manageLink: `https://igniteclubhq.app/club/${sub.club_id}`,
                  clubLogoUrl,
                  primaryColor: '#10b981',
                }
              );
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
