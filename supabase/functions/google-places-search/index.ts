// Google Places proxy: autocomplete (search) and details/reverse geocoding
// Uses Places API (New) v1
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SearchBody {
  action: 'autocomplete' | 'details' | 'reverse';
  query?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  sessionToken?: string;
}

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated user (protects Google Places quota from anonymous abuse).
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const { data: claims, error: claimsError } = await supabaseAuth.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json()) as SearchBody;
    if (!body || !body.action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'autocomplete') {
      const query = (body.query || '').trim();
      if (query.length < 2) {
        return new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        },
        body: JSON.stringify({
          input: query,
          includedRegionCodes: ['au'],
          sessionToken: body.sessionToken,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('Google autocomplete error:', data);
        return new Response(JSON.stringify({ error: data }), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const suggestions = (data.suggestions || [])
        .filter((s: any) => s.placePrediction)
        .map((s: any) => ({
          place_id: s.placePrediction.placeId,
          description: s.placePrediction.text?.text || '',
          main_text: s.placePrediction.structuredFormat?.mainText?.text || '',
          secondary_text: s.placePrediction.structuredFormat?.secondaryText?.text || '',
        }));

      return new Response(JSON.stringify({ suggestions }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'details') {
      if (!body.placeId) {
        return new Response(JSON.stringify({ error: 'placeId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(body.placeId)}`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask':
              'id,displayName,formattedAddress,addressComponents,location,shortFormattedAddress',
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        console.error('Google details error:', data);
        return new Response(JSON.stringify({ error: data }), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const place = parsePlace(data);
      return new Response(JSON.stringify({ place }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'reverse') {
      if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
        return new Response(JSON.stringify({ error: 'lat/lng required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Use Geocoding API for reverse geocoding
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${body.lat},${body.lng}&key=${GOOGLE_PLACES_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.status !== 'OK') {
        console.error('Google reverse geocode error:', data);
        return new Response(JSON.stringify({ error: data }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = data.results?.[0];
      if (!result) {
        return new Response(JSON.stringify({ place: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const components = result.address_components || [];
      const get = (type: string) =>
        components.find((c: any) => c.types?.includes(type))?.long_name || '';
      const streetNumber = get('street_number');
      const route = get('route');
      const street = [streetNumber, route].filter(Boolean).join(' ');
      const place = {
        place_id: result.place_id,
        name: '',
        formatted_address: result.formatted_address,
        street,
        suburb: get('locality') || get('sublocality') || get('postal_town'),
        state: get('administrative_area_level_1'),
        postcode: get('postal_code'),
        country: get('country'),
        lat: result.geometry?.location?.lat,
        lng: result.geometry?.location?.lng,
      };
      return new Response(JSON.stringify({ place }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('google-places-search error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parsePlace(data: any) {
  const components = data.addressComponents || [];
  const get = (type: string) =>
    components.find((c: any) => c.types?.includes(type))?.longText || '';
  const streetNumber = get('street_number');
  const route = get('route');
  const street = [streetNumber, route].filter(Boolean).join(' ');
  const name = data.displayName?.text || '';
  return {
    place_id: data.id,
    name,
    formatted_address: data.formattedAddress || '',
    short_formatted_address: data.shortFormattedAddress || '',
    street,
    suburb: get('locality') || get('sublocality') || get('postal_town'),
    state: get('administrative_area_level_1'),
    postcode: get('postal_code'),
    country: get('country'),
    lat: data.location?.latitude,
    lng: data.location?.longitude,
  };
}
