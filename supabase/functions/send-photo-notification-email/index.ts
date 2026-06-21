import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PhotoNotificationRequest {
  recipientUserId: string;
  uploaderUserId: string;
  photoId: string;
  contextType: 'team' | 'club';
  contextId: string;
  contextName: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authErr = requireServiceRoleAuth(req, corsHeaders);
  if (authErr) return authErr;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      recipientUserId, 
      uploaderUserId, 
      photoId,
      contextType,
      contextId, 
      contextName 
    }: PhotoNotificationRequest = await req.json();

    console.log(`Processing photo notification email for recipient ${recipientUserId} from uploader ${uploaderUserId}`);

    // First check if user profile still exists (not deleted)
    const { data: profileExists } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', recipientUserId)
      .single();

    if (!profileExists) {
      console.log('User profile does not exist (deleted user), skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'user_deleted' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if user still has roles in any club/team (hasn't left)
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('club_id, team_id')
      .eq('user_id', recipientUserId);

    if (!userRoles || userRoles.length === 0) {
      console.log('User has no active roles (left all clubs/teams), skipping email');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_active_roles' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if user is in any active club/team subscription
    let hasActiveSubscription = false;
    const now = new Date().toISOString();

    const clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))];
    const teamIds = [...new Set(userRoles.map(r => r.team_id).filter(Boolean))];

    if (clubIds.length > 0) {
      const { data: clubSubs } = await supabase
        .from('club_subscriptions')
        .select('club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at')
        .in('club_id', clubIds);

      hasActiveSubscription = clubSubs?.some(sub => 
        (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) &&
        (!sub.expires_at || sub.expires_at > now)
      ) ?? false;
    }

    if (!hasActiveSubscription && teamIds.length > 0) {
      const { data: teamSubs } = await supabase
        .from('team_subscriptions')
        .select('team_id, is_pro, is_pro_football, expires_at')
        .in('team_id', teamIds);

      hasActiveSubscription = teamSubs?.some(sub => 
        (sub.is_pro || sub.is_pro_football) && (!sub.expires_at || sub.expires_at > now)
      ) ?? false;
    }

    if (!hasActiveSubscription) {
      console.log(`User ${recipientUserId} is not in any active subscription, skipping email`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_active_subscription' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if recipient has email_media_enabled
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_media_enabled')
      .eq('user_id', recipientUserId)
      .single();

    // Default to FALSE — users must explicitly opt in to photo email notifications
    const emailMediaEnabled = prefs?.email_media_enabled === true;
    
    if (!emailMediaEnabled) {
      console.log(`Email media notifications not explicitly enabled for user ${recipientUserId} (opt-in required)`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'email_media_disabled' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get recipient email and name
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', recipientUserId)
      .single();

    // Batched RPC instead of auth admin REST call (prevents connection pool exhaustion)
    const { data: emailRows } = await supabase
      .rpc("get_user_emails", { user_ids: [recipientUserId] });
    const recipientEmail = emailRows?.[0]?.email as string | undefined;

    if (!recipientEmail) {
      console.log(`No email found for recipient ${recipientUserId}`);
      return new Response(
        JSON.stringify({ success: false, error: 'No email for recipient' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get uploader name
    const { data: uploaderProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', uploaderUserId)
      .single();

    // Get club logo if available
    let clubLogoUrl: string | undefined;
    if (contextType === 'club') {
      const { data: club } = await supabase
        .from('clubs')
        .select('logo_url')
        .eq('id', contextId)
        .single();
      clubLogoUrl = club?.logo_url || undefined;
    } else if (contextType === 'team') {
      const { data: team } = await supabase
        .from('teams')
        .select('club_id, clubs!club_id(logo_url)')
        .eq('id', contextId)
        .single();
      clubLogoUrl = (team?.clubs as any)?.logo_url || undefined;
    }

    // Build photo link
    const photoLink = contextType === 'team' 
      ? `/media?team=${contextId}` 
      : `/media?club=${contextId}`;

    // Send email via send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipientAuth.user.email,
        subject: `📷 New photo in ${contextName}`,
        template: 'photo-uploaded',
        templateData: {
          recipientName: recipientProfile?.display_name || 'Team Member',
          uploaderName: uploaderProfile?.display_name || 'Someone',
          contextType,
          contextName,
          photoLink,
          clubLogoUrl,
        },
      },
    });

    if (emailError) {
      console.error('Error sending photo notification email:', emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Photo notification email sent successfully to ${recipientAuth.user.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    console.error("Error in send-photo-notification-email:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
