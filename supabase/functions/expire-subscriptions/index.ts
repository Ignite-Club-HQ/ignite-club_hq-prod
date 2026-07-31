import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await isAuthorizedCronCaller(req))) {
    console.error('Unauthorized: caller is not an authorized cron/internal caller');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();
    let teamExpiredCount = 0;
    let clubExpiredCount = 0;

    // ==========================================
    // TEAM SUBSCRIPTIONS
    // ==========================================
    const { data: expiredTeamSubs, error: teamFetchError } = await supabase
      .from('team_subscriptions')
      .select('id, team_id, is_pro, is_pro_football, expires_at')
      .lt('expires_at', now)
      .or('is_pro.eq.true,is_pro_football.eq.true');

    if (teamFetchError) {
      console.error('Error fetching expired team subscriptions:', teamFetchError);
      throw teamFetchError;
    }

    if (expiredTeamSubs && expiredTeamSubs.length > 0) {
      console.log(`Found ${expiredTeamSubs.length} expired team subscriptions`);

      const expiredTeamIds = expiredTeamSubs.map(sub => sub.id);
      
      const { error: teamUpdateError } = await supabase
        .from('team_subscriptions')
        .update({ is_pro: false, is_pro_football: false })
        .in('id', expiredTeamIds);

      if (teamUpdateError) {
        console.error('Error updating expired team subscriptions:', teamUpdateError);
        throw teamUpdateError;
      }

      // Send notifications to team admins
      for (const sub of expiredTeamSubs) {
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

          const notifications = teamAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_expired',
            message: `${teamName}'s ${tierName} subscription has expired. Renew to continue accessing Pro features.`,
            related_id: sub.team_id,
          }));

          await supabase.from('notifications').insert(notifications);
        }
      }

      teamExpiredCount = expiredTeamSubs.length;
      console.log(`Successfully expired ${teamExpiredCount} team subscriptions`);
    } else {
      console.log('No expired team subscriptions found');
    }

    // ==========================================
    // CLUB SUBSCRIPTIONS
    // ==========================================
    const { data: expiredClubSubs, error: clubFetchError } = await supabase
      .from('club_subscriptions')
      .select('id, club_id, is_pro, is_pro_football, expires_at')
      .lt('expires_at', now)
      .or('is_pro.eq.true,is_pro_football.eq.true');

    if (clubFetchError) {
      console.error('Error fetching expired club subscriptions:', clubFetchError);
      throw clubFetchError;
    }

    if (expiredClubSubs && expiredClubSubs.length > 0) {
      console.log(`Found ${expiredClubSubs.length} expired club subscriptions`);

      const expiredClubSubIds = expiredClubSubs.map(sub => sub.id);
      
      // Update club_subscriptions - this will trigger sync_club_pro_status to update clubs.is_pro
      const { error: clubUpdateError } = await supabase
        .from('club_subscriptions')
        .update({ is_pro: false, is_pro_football: false })
        .in('id', expiredClubSubIds);

      if (clubUpdateError) {
        console.error('Error updating expired club subscriptions:', clubUpdateError);
        throw clubUpdateError;
      }

      // Send notifications to club admins
      for (const sub of expiredClubSubs) {
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

          const notifications = clubAdmins.map(admin => ({
            user_id: admin.user_id,
            type: 'subscription_expired',
            message: `${clubName}'s ${tierName} subscription has expired. Renew to continue accessing Pro features.`,
            related_id: sub.club_id,
          }));

          await supabase.from('notifications').insert(notifications);
        }
      }

      clubExpiredCount = expiredClubSubs.length;
      console.log(`Successfully expired ${clubExpiredCount} club subscriptions`);
    } else {
      console.log('No expired club subscriptions found');
    }

    const totalExpired = teamExpiredCount + clubExpiredCount;

    return new Response(
      JSON.stringify({ 
        message: 'Successfully processed expired subscriptions', 
        teamExpired: teamExpiredCount,
        clubExpired: clubExpiredCount,
        total: totalExpired
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in expire-subscriptions function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
