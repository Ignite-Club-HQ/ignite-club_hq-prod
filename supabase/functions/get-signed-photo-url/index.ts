import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeExpiresIn,
  parseStorageObjectRef,
} from "../_shared/storageUrlAuth.ts";

// Module-scope client: created once per isolate, reused across warm invocations.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json();
    const paths = body?.paths;
    const expiresIn = normalizeExpiresIn(body?.expiresIn);

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

    // 1. Resolve each requested URL to a { bucket, path } on OUR storage origin.
    //    Anything else is either a genuinely non-private URL (returned unchanged)
    //    or malformed/external (omitted).
    const refs = new Map<string, { bucket: string; path: string }>();
    const signedUrls: Record<string, string> = {};

    for (const raw of paths) {
      if (typeof raw !== "string") continue;
      const ref = parseStorageObjectRef(raw, SUPABASE_URL);
      if (ref) {
        refs.set(raw, ref);
        continue;
      }
      // Not a private-bucket object on our origin. Only pass through URLs that
      // do not pretend to be private storage objects.
      if (!/\/storage\/v1\/object\//.test(raw)) {
        signedUrls[raw] = raw;
      }
    }

    if (refs.size === 0) {
      return new Response(JSON.stringify({ signedUrls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Authorize every object for THIS user before signing anything.
    const items = Array.from(refs.values());
    const { data: decisions, error: authzError } = await supabase.rpc(
      "authorize_storage_objects",
      { _user_id: user.id, _items: items },
    );

    if (authzError) {
      console.error("authorize_storage_objects failed:", authzError.message);
      return new Response(JSON.stringify({ error: "Authorization check failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allowedKeys = new Set(
      (decisions ?? [])
        .filter((d: any) => d.allowed === true)
        .map((d: any) => `${d.bucket}/${d.path}`),
    );

    // 3. Sign only authorized objects. Denied paths are omitted entirely —
    //    never returned raw — and do not affect their authorized siblings.
    for (const [raw, ref] of refs.entries()) {
      if (!allowedKeys.has(`${ref.bucket}/${ref.path}`)) continue;

      const { data, error } = await supabase.storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, expiresIn);

      if (error || !data) {
        console.error(`Error creating signed URL for ${ref.bucket}:`, error?.message);
        continue;
      }
      signedUrls[raw] = data.signedUrl;
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
