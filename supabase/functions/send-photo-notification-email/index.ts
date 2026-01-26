import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Check if user is in any active club/team subscription
    const { data: activeRoles } = await supabase
      .from('user_roles')
      .select(`
        club_id,
        team_id,
        clubs:club_id(
          club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)
        ),
        teams:team_id(
          club_id,
          team_subscriptions(is_pro, is_pro_football, expires_at)
        )
      `)
      .eq('user_id', recipientUserId);

    const hasActiveSubscription = activeRoles?.some(role => {
      const clubSubs = (role.clubs as any)?.club_subscriptions;
      if (clubSubs) {
        const sub = Array.isArray(clubSubs) ? clubSubs[0] : clubSubs;
        if (sub && (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override)) {
          if (!sub.expires_at || new Date(sub.expires_at) > new Date()) {
            return true;
          }
        }
      }
      const teamSubs = (role.teams as any)?.team_subscriptions;
      if (teamSubs) {
        const sub = Array.isArray(teamSubs) ? teamSubs[0] : teamSubs;
        if (sub && (sub.is_pro || sub.is_pro_football)) {
          if (!sub.expires_at || new Date(sub.expires_at) > new Date()) {
            return true;
          }
        }
      }
      return false;
    }) ?? false;

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

    // Default to true if no preference exists
    const emailMediaEnabled = prefs?.email_media_enabled ?? true;
    
    if (!emailMediaEnabled) {
      console.log(`Email media notifications disabled for user ${recipientUserId}`);
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

    const { data: recipientAuth } = await supabase.auth.admin.getUserById(recipientUserId);
    
    if (!recipientAuth?.user?.email) {
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
        .select('club_id, clubs(logo_url)')
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
