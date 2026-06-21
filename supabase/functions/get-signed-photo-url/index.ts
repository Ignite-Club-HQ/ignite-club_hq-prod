import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Module-scope client: created once per isolate, reused across warm invocations.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Supported private buckets
const PRIVATE_BUCKETS = ["photos", "chat-attachments", "avatars"];

// Rate limiting to prevent enumeration attacks
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 100; // Allow 100 requests per minute for normal usage

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .single();

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);
    
    if (recordWindowStart < windowStart) {
      await supabase.from('rate_limits').update({
        request_count: 1,
        window_start: now.toISOString(),
        updated_at: now.toISOString()
      }).eq('id', existing.id);
      
      return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    if (existing.request_count >= RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: false, remaining: 0, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    await supabase.from('rate_limits').update({
      request_count: existing.request_count + 1,
      updated_at: now.toISOString()
    }).eq('id', existing.id);

    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - existing.request_count - 1, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
  }

  await supabase.from('rate_limits').insert({ identifier, endpoint, request_count: 1, window_start: now.toISOString() });
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reuse module-scope admin client (created at cold start).
    const supabase = supabaseAdmin;


    // Verify the user is authenticated
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limiting check to prevent enumeration attacks
    const rateLimitResult = await checkRateLimit(supabase, user.id, 'get-signed-photo-url');
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id} on get-signed-photo-url`);
      return new Response(
        JSON.stringify({ 
          error: "Too many requests. Please slow down.",
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000))
          } 
        }
      );
    }

    const { paths, expiresIn = 3600 } = await req.json();

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: "paths array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Limit to 50 URLs per request to prevent abuse
    if (paths.length > 50) {
      return new Response(JSON.stringify({ error: "Maximum 50 paths per request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URLs for each path
    const signedUrls: Record<string, string> = {};
    
    for (const path of paths) {
      // Detect which bucket this URL belongs to
      let bucketId: string | null = null;
      let storagePath = path;

      for (const bucket of PRIVATE_BUCKETS) {
        if (path.includes(`/storage/v1/object/public/${bucket}/`)) {
          bucketId = bucket;
          storagePath = path.split(`/storage/v1/object/public/${bucket}/`)[1];
          break;
        } else if (path.includes(`/storage/v1/object/sign/${bucket}/`)) {
          bucketId = bucket;
          storagePath = path.split(`/storage/v1/object/sign/${bucket}/`)[1].split("?")[0];
          break;
        }
      }

      // Skip if not a recognized private bucket URL
      if (!bucketId) {
        signedUrls[path] = path; // Return original URL
        continue;
      }

      const { data, error } = await supabase.storage
        .from(bucketId)
        .createSignedUrl(storagePath, expiresIn);

      if (error) {
        console.error(`Error creating signed URL for ${bucketId}/${storagePath}:`, error);
        // Skip this URL but continue with others
        continue;
      }

      signedUrls[path] = data.signedUrl;
    }

    return new Response(JSON.stringify({ signedUrls }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in get-signed-photo-url:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
