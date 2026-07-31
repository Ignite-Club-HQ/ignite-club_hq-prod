import { requireServiceRoleAuth } from "../_shared/callerAuth.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default configuration (used if database settings not found)
const DEFAULT_SETTINGS = {
  failure_threshold_percent: 20,
  check_window_hours: 24,
  min_notifications: 10,
  cooldown_hours: 6,
  alerts_enabled: true,
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const __authError = requireServiceRoleAuth(req, corsHeaders);
  if (__authError) return __authError;


  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load settings from database
    const { data: settingsData } = await supabase
      .from("push_alert_settings")
      .select("*")
      .limit(1)
      .single();

    const settings = settingsData || DEFAULT_SETTINGS;
    
    console.log(`Using settings: threshold=${settings.failure_threshold_percent}%, window=${settings.check_window_hours}h, min=${settings.min_notifications}, cooldown=${settings.cooldown_hours}h, enabled=${settings.alerts_enabled}`);

    // Check if alerts are enabled
    if (!settings.alerts_enabled) {
      console.log("Push failure alerts are disabled");
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "alerts_disabled"
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const windowStart = new Date(Date.now() - settings.check_window_hours * 60 * 60 * 1000);

    // Get notification stats from the configured time window
    const { data: logs, error: logsError } = await supabase
      .from("push_notification_logs")
      .select("status")
      .gte("created_at", windowStart.toISOString());

    if (logsError) {
      console.error("Error fetching logs:", logsError);
      throw logsError;
    }

    if (!logs || logs.length < settings.min_notifications) {
      console.log(`Only ${logs?.length || 0} notifications in window, skipping alert check (minimum: ${settings.min_notifications})`);
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "insufficient_volume",
          notificationCount: logs?.length || 0
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Calculate failure rate
    const total = logs.length;
    const failed = logs.filter(l => l.status === "failed").length;
    const expired = logs.filter(l => l.status === "expired").length;
    const sent = logs.filter(l => l.status === "sent").length;
    const failureRate = ((failed + expired) / total) * 100;

    console.log(`Push notification stats (last ${settings.check_window_hours}h): ${total} total, ${sent} sent, ${failed} failed, ${expired} expired, ${failureRate.toFixed(1)}% failure rate`);

    if (failureRate <= settings.failure_threshold_percent) {
      console.log(`Failure rate ${failureRate.toFixed(1)}% is within threshold (${settings.failure_threshold_percent}%)`);
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "within_threshold",
          stats: { total, sent, failed, expired, failureRate: failureRate.toFixed(1) }
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if we already sent an alert recently (based on cooldown setting)
    const recentAlertWindow = new Date(Date.now() - settings.cooldown_hours * 60 * 60 * 1000);
    const { data: recentAlerts } = await supabase
      .from("admin_alerts")
      .select("id")
      .eq("alert_type", "push_failure_rate")
      .gte("created_at", recentAlertWindow.toISOString())
      .limit(1);

    if (recentAlerts && recentAlerts.length > 0) {
      console.log(`Alert already sent within last ${settings.cooldown_hours} hours, skipping`);
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "recent_alert_exists",
          stats: { total, sent, failed, expired, failureRate: failureRate.toFixed(1) }
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get app admin emails
    const { data: adminRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "app_admin");

    if (rolesError || !adminRoles?.length) {
      console.error("Error fetching admin roles or no admins found:", rolesError);
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "no_admins_found"
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get admin emails from auth.users (profiles table does not store email)
    const adminUserIds = adminRoles.map(r => r.user_id);
    const adminEmails: string[] = [];
    for (const uid of adminUserIds) {
      const { data: userResult, error: userErr } = await supabase.auth.admin.getUserById(uid);
      if (userErr) {
        console.error(`[check-push-failure-rate] Error fetching auth user ${uid}:`, userErr);
        continue;
      }
      const email = userResult?.user?.email;
      if (email) adminEmails.push(email);
    }

    if (adminEmails.length === 0) {
      console.log("No admin emails available");
      return new Response(
        JSON.stringify({ 
          checked: true, 
          alertSent: false, 
          reason: "no_admin_emails"
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Send alert email
    const alertHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">⚠️ Push Notification Alert</h1>
        </div>
        <div style="background: #fef2f2; padding: 24px; border: 1px solid #fecaca; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #991b1b; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">
            High failure rate detected: ${failureRate.toFixed(1)}%
          </p>
          <p style="color: #7f1d1d; margin: 0 0 20px 0;">
            The push notification failure rate has exceeded the ${settings.failure_threshold_percent}% threshold in the last ${settings.check_window_hours} hours.
          </p>
          
          <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 12px 0; color: #374151;">Statistics</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Total Notifications</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${total}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Successfully Sent</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #059669;">${sent}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Failed</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">${failed}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Expired</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #d97706;">${expired}</td>
              </tr>
            </table>
          </div>
          
          <p style="color: #7f1d1d; margin: 0 0 16px 0;">
            <strong>Recommended actions:</strong>
          </p>
          <ul style="color: #7f1d1d; margin: 0; padding-left: 20px;">
            <li>Check the Push Analytics dashboard for detailed logs</li>
            <li>Run the subscription cleanup job to remove stale endpoints</li>
            <li>Verify VAPID keys are correctly configured</li>
            <li>Check for any service disruptions</li>
          </ul>
          
          <div style="margin-top: 24px;">
            <a href="https://ignite-club-launchpad.lovable.app/admin/push-analytics" 
               style="display: inline-block; background: #f97316; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              View Push Analytics →
            </a>
          </div>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          This is an automated alert from Ignite Club HQ. You will not receive another alert for ${settings.cooldown_hours} hours.
        </p>
      </div>
    `;

    // Use the send-email edge function
    const { error: emailError } = await supabase.functions.invoke("send-email", {
      body: {
        to: adminEmails,
        subject: `⚠️ Push Notification Alert: ${failureRate.toFixed(1)}% failure rate`,
        html: alertHtml,
      },
    });

    if (emailError) {
      console.error("Error sending alert email:", emailError);
      throw emailError;
    }

    // Log the alert to prevent duplicates
    await supabase.from("admin_alerts").insert({
      alert_type: "push_failure_rate",
      details: {
        total,
        sent,
        failed,
        expired,
        failureRate: failureRate.toFixed(1),
        threshold: settings.failure_threshold_percent,
        windowHours: settings.check_window_hours,
        cooldownHours: settings.cooldown_hours,
        recipientCount: adminEmails.length,
      },
    });

    console.log(`Alert sent to ${adminEmails.length} admin(s)`);

    return new Response(
      JSON.stringify({ 
        checked: true, 
        alertSent: true, 
        recipientCount: adminEmails.length,
        stats: { total, sent, failed, expired, failureRate: failureRate.toFixed(1) }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error) {
    console.error("Error in check-push-failure-rate:", error);
    return new Response(
      JSON.stringify({ error: "Failed to check push failure rate" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
