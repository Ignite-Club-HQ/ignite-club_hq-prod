import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const clubId = url.searchParams.get('club_id');
    const clubName = url.searchParams.get('club_name');

    if (!clubId && !clubName) {
      return new Response(
        JSON.stringify({ error: 'Either club_id or club_name query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let resolvedClubId = clubId;

    if (!resolvedClubId && clubName) {
      const { data: club, error: clubError } = await supabase
        .from('clubs')
        .select('id, name')
        .ilike('name', clubName)
        .maybeSingle();

      if (clubError) {
        console.error('Error looking up club:', clubError);
        return new Response(
          JSON.stringify({ error: 'Failed to look up club' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!club) {
        return new Response(
          JSON.stringify({ error: 'Club not found', club_name: clubName }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      resolvedClubId = club.id;
    }

    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, level_age, team_type')
      .eq('club_id', resolvedClubId)
      .order('name', { ascending: true });

    if (teamsError) {
      console.error('Error fetching teams:', teamsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch teams' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formattedTeams = (teams || []).map((t) => ({
      id: t.id,
      name: t.name,
      age_group: t.level_age || null,
      category: t.team_type || null,
    }));

    return new Response(
      JSON.stringify({ club_id: resolvedClubId, teams: formattedTeams }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in public-club-teams:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
