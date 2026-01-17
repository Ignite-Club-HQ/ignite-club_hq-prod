import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Security headers to prevent common attacks
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...securityHeaders,
};

// Strict rate limiting for sensitive operations
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour window
const RATE_LIMIT_MAX_REQUESTS = 3; // Only 3 deletion attempts per hour
const MAX_REQUEST_SIZE = 1024; // 1KB max for this endpoint

// Sanitize error messages to prevent information leakage
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Remove any sensitive patterns
  const sensitivePatterns = [
    /password/gi,
    /secret/gi,
    /key/gi,
    /token/gi,
    /credential/gi,
    /api[_-]?key/gi,
    /auth/gi,
    /bearer/gi,
    /connection.*string/gi,
    /database.*url/gi,
  ];
  
  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

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
      
      return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
    }

    if (existing.request_count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: new Date(recordWindowStart.getTime() + windowSeconds * 1000) };
    }

    await supabase.from('rate_limits').update({
      request_count: existing.request_count + 1,
      updated_at: now.toISOString()
    }).eq('id', existing.id);

    return { allowed: true, remaining: maxRequests - existing.request_count - 1, resetAt: new Date(recordWindowStart.getTime() + windowSeconds * 1000) };
  }

  await supabase.from('rate_limits').insert({ identifier, endpoint, request_count: 1, window_start: now.toISOString() });
  return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check request size to prevent memory exhaustion
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
      return new Response(
        JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting check - strict limits for account deletion
    const rateLimitResult = await checkRateLimit(adminClient, user.id, 'delete-account');
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for delete-account`);
      return new Response(
        JSON.stringify({ 
          error: "Too many attempts. Please try again later.",
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
    
    // Schedule deletion for 30 days from now instead of immediate deletion
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 30);

    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ scheduled_deletion_at: deletionDate.toISOString() })
      .eq('id', user.id);

    if (updateError) {
      console.error("Error scheduling deletion:", sanitizeError(updateError));
      return new Response(
        JSON.stringify({ error: "Failed to process request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Account scheduled for deletion on ${deletionDate.toISOString()}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletionDate: deletionDate.toISOString(),
        message: "Account scheduled for deletion in 30 days"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", sanitizeError(error));
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
