import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Storage limits in bytes
const FREE_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5GB base
const BYTES_PER_GB = 1024 * 1024 * 1024;

// Warning thresholds
const WARNING_THRESHOLD_PERCENT = 80; // Send warning at 80%
const CRITICAL_THRESHOLD_PERCENT = 95; // Send critical warning at 95%

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

    const now = new Date();
    let clubWarnings = 0;
    let teamWarnings = 0;

    // ==========================================
    // CLUB STORAGE WARNINGS
    // ==========================================
    
    // Get all clubs with their storage usage and subscription info
    const { data: clubs, error: clubError } = await supabase
      .from('clubs')
      .select(`
        id,
        name,
        logo_url,
        storage_used_bytes,
        club_subscriptions (
          storage_purchased_gb,
          is_pro,
          is_pro_football
        )
      `);

    if (clubError) {
      console.error('Error fetching clubs:', clubError);
      throw clubError;
    }

    if (clubs && clubs.length > 0) {
      for (const club of clubs) {
        // Calculate total storage limit (base + purchased)
        // club_subscriptions is an array (one-to-many relation returns array), get the first item
        const subscription = Array.isArray(club.club_subscriptions) 
          ? club.club_subscriptions[0] 
          : club.club_subscriptions;
        const purchasedGB = subscription?.storage_purchased_gb || 0;
        const totalStorageLimitBytes = FREE_STORAGE_LIMIT_BYTES + (purchasedGB * BYTES_PER_GB);
        const storageUsedBytes = club.storage_used_bytes || 0;
        const usagePercentage = Math.round((storageUsedBytes / totalStorageLimitBytes) * 100);

        // Check if we should send a warning
        if (usagePercentage < WARNING_THRESHOLD_PERCENT) {
          continue; // Storage usage is fine
        }

        // Determine warning level
        const isCritical = usagePercentage >= CRITICAL_THRESHOLD_PERCENT;
        const notificationType = isCritical ? 'storage_critical' : 'storage_warning';

        // Check if we already sent a notification recently (within 7 days for warning, 1 day for critical)
        const cooldownHours = isCritical ? 24 : 168; // 1 day for critical, 7 days for warning
        const cooldownDate = new Date(now.getTime() - cooldownHours * 60 * 60 * 1000);

        const { data: existingNotif } = await supabase
          .from('notifications')
          .select('id')
          .eq('related_id', club.id)
          .eq('type', notificationType)
          .gte('created_at', cooldownDate.toISOString())
          .limit(1);

        if (existingNotif && existingNotif.length > 0) {
          console.log(`Storage ${isCritical ? 'critical' : 'warning'} already sent for club ${club.id}, skipping`);
          continue;
        }

        // Get club admins
        const { data: clubAdmins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('club_id', club.id)
          .eq('role', 'club_admin');

        if (!clubAdmins || clubAdmins.length === 0) {
          continue;
        }

        const clubName = club.name || 'Your club';
        const clubLogoUrl = club.logo_url || undefined;
        const storageUsedGB = storageUsedBytes / BYTES_PER_GB;
        const storageLimitGB = totalStorageLimitBytes / BYTES_PER_GB;

        // Create notifications for club admins
        const notifications = clubAdmins.map(admin => ({
          user_id: admin.user_id,
          type: notificationType,
          message: isCritical 
            ? `🚨 ${clubName}'s storage is ${usagePercentage}% full! Upgrade now to avoid interruptions.`
            : `⚠️ ${clubName}'s storage is ${usagePercentage}% full. Consider upgrading.`,
          related_id: club.id,
        }));

        await supabase.from('notifications').insert(notifications);
        clubWarnings++;

        // Send emails to club admins
        const adminIds = clubAdmins.map(a => a.user_id);
        const { data: adminEmails } = await supabase
          .rpc('get_user_emails_by_ids', { user_ids: adminIds });

        const { data: adminProfiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', adminIds);

        const profileMap = new Map(adminProfiles?.map(p => [p.id, p.display_name]) || []);

        if (adminEmails && adminEmails.length > 0) {
          for (const admin of adminEmails) {
            const emailEnabled = await isEmailAdminEnabled(supabase, admin.user_id);
            if (!emailEnabled) {
              console.log(`User ${admin.user_id} has email_admin_enabled=false, skipping storage email`);
              continue;
            }
            
            const recipientName = profileMap.get(admin.user_id) || undefined;
            const subject = isCritical
              ? `🚨 Critical: ${clubName}'s storage is almost full`
              : `⚠️ ${clubName}'s storage is running low`;
            
            await sendTemplateEmail(
              supabase,
              admin.email,
              subject,
              'storage-warning',
              {
                recipientName,
                entityName: clubName,
                entityType: 'club',
                storageUsedGB,
                storageLimitGB,
                usagePercentage,
                upgradeLink: `https://igniteclubhq.app/club/${club.id}/upgrade?tab=storage`,
                clubLogoUrl,
                primaryColor: '#10b981',
              }
            );
          }
        }
      }
    }

    // ==========================================
    // TEAM STORAGE WARNINGS (for teams with team-level subscriptions)
    // ==========================================
    
    // Get teams with team subscriptions that have storage
    const { data: teamSubs, error: teamError } = await supabase
      .from('team_subscriptions')
      .select(`
        id,
        team_id,
        is_pro,
        is_pro_football,
        storage_purchased_gb,
        teams (
          id,
          name,
          logo_url,
          club_id,
          clubs!club_id (
            name,
            logo_url,
            storage_used_bytes
          )
        )
      `)
      .or('is_pro.eq.true,is_pro_football.eq.true');

    if (teamError) {
      console.error('Error fetching team subscriptions:', teamError);
    }

    // Note: Team storage is typically managed at club level
    // This section handles teams with individual storage allocations if needed
    if (teamSubs && teamSubs.length > 0) {
      for (const sub of teamSubs) {
        if (!sub.teams) continue;

        // If team has its own storage purchased, check that
        const purchasedGB = sub.storage_purchased_gb || 0;
        if (purchasedGB === 0) continue; // No team-specific storage to check

        const totalStorageLimitBytes = purchasedGB * BYTES_PER_GB;
        // For team-level, we'd need team-specific storage tracking
        // For now, we skip if no team-specific storage purchased
        
        // sub.teams is an array due to the join, get the first item
        const teamData = Array.isArray(sub.teams) ? sub.teams[0] : sub.teams;
        if (!teamData) continue;
        
        const clubsData = Array.isArray(teamData.clubs) ? teamData.clubs[0] : teamData.clubs;
        const clubLogoUrl = clubsData?.logo_url || teamData.logo_url || undefined;

        // Get team admins
        const { data: teamAdmins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', sub.team_id)
          .in('role', ['team_admin', 'coach']);

        if (!teamAdmins || teamAdmins.length === 0) {
          continue;
        }

        // Note: Full team storage implementation would go here
        // For now, we're focusing on club-level storage which is the primary model
      }
    }

    console.log(`Sent ${clubWarnings} club storage warnings and ${teamWarnings} team storage warnings`);

    return new Response(
      JSON.stringify({
        message: 'Storage warnings sent',
        clubWarnings,
        teamWarnings,
        total: clubWarnings + teamWarnings
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in send-storage-warnings:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
