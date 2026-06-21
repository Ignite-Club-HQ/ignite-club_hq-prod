import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireServiceRoleAuth } from '../_shared/internal-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GameStatsEmailRequest {
  eventId: string;
  teamId: string;
  eventTitle: string;
  eventDate: string;
  opponent?: string;
  totalPlayers: number;
  totalGameTime: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authErr = requireServiceRoleAuth(req, corsHeaders);
  if (authErr) return authErr;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      eventId,
      teamId,
      eventTitle,
      eventDate,
      opponent,
      totalPlayers,
      totalGameTime,
    }: GameStatsEmailRequest = await req.json();

    console.log(`[GAME-STATS-EMAIL] Processing for team ${teamId}, event ${eventId}`);

    // Get team and club info
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, name, club_id, clubs!club_id(id, name, logo_url)')
      .eq('id', teamId)
      .single();

    if (teamError || !team) {
      console.error('[GAME-STATS-EMAIL] Team not found:', teamError);
      return new Response(
        JSON.stringify({ error: 'Team not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // clubs is returned as an object (not array) due to foreign key relationship
    // deno-lint-ignore no-explicit-any
    const clubData = team.clubs as any;
    const club = clubData ? { id: clubData.id, name: clubData.name, logo_url: clubData.logo_url } : null;

    // Check if club has Pro Football subscription
    const { data: clubSub } = await supabase
      .from('club_subscriptions')
      .select('is_pro_football, admin_pro_football_override')
      .eq('club_id', team.club_id)
      .maybeSingle();

    const { data: teamSub } = await supabase
      .from('team_subscriptions')
      .select('is_pro_football, admin_pro_football_override')
      .eq('team_id', teamId)
      .maybeSingle();

    const hasProFootball = 
      clubSub?.is_pro_football === true || 
      clubSub?.admin_pro_football_override === true ||
      teamSub?.is_pro_football === true ||
      teamSub?.admin_pro_football_override === true;

    if (!hasProFootball) {
      console.log('[GAME-STATS-EMAIL] Team does not have Pro Football subscription, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_pro_football' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get team admins and coaches
    const { data: teamStaff, error: staffError } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('team_id', teamId)
      .in('role', ['team_admin', 'coach']);

    if (staffError) {
      console.error('[GAME-STATS-EMAIL] Error fetching team staff:', staffError);
      throw staffError;
    }

    if (!teamStaff || teamStaff.length === 0) {
      console.log('[GAME-STATS-EMAIL] No team admins or coaches found');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_recipients' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[GAME-STATS-EMAIL] Found ${teamStaff.length} team staff members`);

    // Report link
    const reportLink = `/reports/player-stats`;

    let emailsSent = 0;
    let emailsSkipped = 0;

    for (const staff of teamStaff) {
      // Check notification preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('email_pom_enabled')
        .eq('user_id', staff.user_id)
        .single();

      // Use email_pom_enabled for game stats (POM = Player of Match / game-related)
      // Default to true if not set
      if (prefs?.email_pom_enabled === false) {
        console.log(`[GAME-STATS-EMAIL] User ${staff.user_id} has game stats emails disabled`);
        emailsSkipped++;
        continue;
      }

      // Get user email via batched RPC (avoids auth admin pool exhaustion)
      const { data: emailRows } = await supabase
        .rpc("get_user_emails", { user_ids: [staff.user_id] });
      const staffEmail = emailRows?.[0]?.email as string | undefined;

      if (!staffEmail) {
        console.log(`[GAME-STATS-EMAIL] User ${staff.user_id} has no email`);
        emailsSkipped++;
        continue;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', staff.user_id)
        .single();

      // Send email
      try {
        const { error: emailError } = await supabase.functions.invoke('send-email', {
          body: {
            to: staffEmail,
            subject: `📊 Game Stats Ready: ${team.name} vs ${opponent || 'Opponent'}`,
            template: 'game-stats-ready',
            templateData: {
              recipientName: profile?.display_name || 'Coach',
              teamName: team.name,
              eventTitle,
              eventDate,
              opponent,
              totalPlayers,
              totalGameTime,
              reportLink,
              clubName: club?.name || 'Your Club',
              clubLogoUrl: club?.logo_url,
            },
          },
        });

        if (emailError) {
          console.error(`[GAME-STATS-EMAIL] Failed to send to ${staff.user_id}:`, emailError);
          emailsSkipped++;
        } else {
          console.log(`[GAME-STATS-EMAIL] Email sent to ${staffEmail}`);
          emailsSent++;
        }
      } catch (err) {
        console.error(`[GAME-STATS-EMAIL] Error sending to ${staff.user_id}:`, err);
        emailsSkipped++;
      }
    }

    console.log(`[GAME-STATS-EMAIL] Complete. Sent: ${emailsSent}, Skipped: ${emailsSkipped}`);

    return new Response(
      JSON.stringify({ success: true, emailsSent, emailsSkipped }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[GAME-STATS-EMAIL] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
