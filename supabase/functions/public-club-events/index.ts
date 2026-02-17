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

    // Resolve club_id from club_name if needed
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title, description, event_date, start_time, end_time, location, location_name, address, type')
      .eq('club_id', resolvedClubId)
      .gte('event_date', today.toISOString())
      .eq('is_cancelled', false)
      .in('type', ['game', 'social', 'training'])
      .order('event_date', { ascending: true })
      .limit(50);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch events' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = 'https://igniteclubhq.app';

    const formattedEvents = (events || []).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      location: e.location_name || e.address || e.location || null,
      type: e.type,
      deep_link: `${baseUrl}/events/${e.id}`,
    }));

    return new Response(
      JSON.stringify({ club_id: resolvedClubId, events: formattedEvents }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in public-club-events:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
