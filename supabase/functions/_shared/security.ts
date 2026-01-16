// Shared security utilities for edge functions

/**
 * Security headers to add to all responses
 * Addresses: Security Headers Missing, Content-Type Sniffing Attack
 */
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

/**
 * CORS headers for edge functions
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Combined headers for responses (security + CORS)
 */
export const responseHeaders = {
  ...corsHeaders,
  ...securityHeaders,
  "Content-Type": "application/json",
};

/**
 * Maximum request body sizes in bytes
 * Addresses: Memory Exhaustion Attack
 */
export const MAX_REQUEST_SIZES = {
  default: 1024 * 1024, // 1MB
  small: 10 * 1024, // 10KB for simple JSON requests
  medium: 100 * 1024, // 100KB
  large: 5 * 1024 * 1024, // 5MB for file uploads
};

/**
 * Check request body size to prevent memory exhaustion
 * Returns true if request is within limits
 */
export function checkRequestSize(req: Request, maxSize: number = MAX_REQUEST_SIZES.default): boolean {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > maxSize) {
      return false;
    }
  }
  return true;
}

/**
 * Create a size-limited request body reader
 * Prevents memory exhaustion by limiting read size
 */
export async function readLimitedBody(req: Request, maxSize: number = MAX_REQUEST_SIZES.default): Promise<string | null> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    return null;
  }

  try {
    const reader = req.body?.getReader();
    if (!reader) return null;

    let totalSize = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder();
    return chunks.map(chunk => decoder.decode(chunk, { stream: true })).join("");
  } catch {
    return null;
  }
}

/**
 * Generic error messages for different error types
 * Addresses: Error Message Information Leakage, Credentials in Error Messages
 */
export const SAFE_ERROR_MESSAGES = {
  unauthorized: "Authentication required",
  forbidden: "Access denied",
  notFound: "Resource not found",
  badRequest: "Invalid request",
  rateLimit: "Too many requests. Please try again later.",
  internal: "An error occurred. Please try again.",
  validation: "Invalid input provided",
  payment: "Payment processing failed. Please try again.",
  timeout: "Request timed out. Please try again.",
};

/**
 * Sanitize error message for client response
 * Strips internal details, stack traces, and sensitive information
 */
export function sanitizeErrorMessage(error: unknown, fallback: string = SAFE_ERROR_MESSAGES.internal): string {
  // Log the full error for debugging (server-side only)
  console.error("Sanitized error:", error);

  // Never expose these patterns to clients
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /credential/i,
    /auth/i,
    /database/i,
    /postgres/i,
    /supabase/i,
    /internal/i,
    /stack/i,
    /at\s+\w+\s+\(/i, // Stack trace pattern
    /line\s+\d+/i,
    /column\s+\d+/i,
    /file:\/\//i,
    /\.ts:\d+/i,
    /\.js:\d+/i,
    /node_modules/i,
    /deno/i,
    /function\s+\w+/i,
  ];

  if (error instanceof Error) {
    const message = error.message;

    // Check for sensitive patterns
    for (const pattern of sensitivePatterns) {
      if (pattern.test(message)) {
        return fallback;
      }
    }

    // Check for known safe messages that can be passed through
    const safeMessages = [
      "Authorization required",
      "Unauthorized",
      "Event not found",
      "Club not found",
      "Team not found",
      "User not found",
      "Invalid request",
      "Missing required field",
      "Rate limit exceeded",
      "Too many requests",
      "Payment required",
      "Subscription required",
      "Not a member",
      "Permission denied",
      "Already exists",
      "Already paid",
      "Event ID is required",
      "Club ID is required",
      "Team ID is required",
    ];

    for (const safe of safeMessages) {
      if (message.toLowerCase().includes(safe.toLowerCase())) {
        return message;
      }
    }

    // For any other message, use fallback
    return fallback;
  }

  return fallback;
}

/**
 * Create a safe error response
 */
export function createErrorResponse(
  error: unknown,
  statusCode: number = 500,
  fallbackMessage?: string
): Response {
  const message = sanitizeErrorMessage(error, fallbackMessage);
  
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: statusCode,
      headers: responseHeaders,
    }
  );
}

/**
 * Create a safe success response
 */
export function createSuccessResponse(data: unknown, statusCode: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status: statusCode,
      headers: responseHeaders,
    }
  );
}

/**
 * Rate limit configuration for different endpoints
 * Addresses: Login Rate Limiting, OTP Brute Force Vulnerability
 */
export const RATE_LIMITS = {
  // Very strict - sensitive operations
  login: { windowSeconds: 300, maxRequests: 5 }, // 5 per 5 minutes
  passwordReset: { windowSeconds: 3600, maxRequests: 3 }, // 3 per hour
  otp: { windowSeconds: 300, maxRequests: 5 }, // 5 per 5 minutes
  accountDeletion: { windowSeconds: 3600, maxRequests: 3 }, // 3 per hour
  
  // Moderate - payment operations
  checkout: { windowSeconds: 60, maxRequests: 10 }, // 10 per minute
  payment: { windowSeconds: 60, maxRequests: 10 },
  
  // Relaxed - general operations
  export: { windowSeconds: 3600, maxRequests: 3 }, // 3 per hour
  signedUrl: { windowSeconds: 60, maxRequests: 100 }, // 100 per minute
  
  // Default
  default: { windowSeconds: 60, maxRequests: 30 },
};

/**
 * Check rate limit using database
 */
export async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string,
  config: { windowSeconds: number; maxRequests: number } = RATE_LIMITS.default
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

  const { data: existing } = await supabase
    .from("rate_limits")
    .select("*")
    .eq("identifier", identifier)
    .eq("endpoint", endpoint)
    .single();

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);

    if (recordWindowStart < windowStart) {
      await supabase
        .from("rate_limits")
        .update({
          request_count: 1,
          window_start: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id);

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: new Date(now.getTime() + config.windowSeconds * 1000),
      };
    }

    if (existing.request_count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(recordWindowStart.getTime() + config.windowSeconds * 1000),
      };
    }

    await supabase
      .from("rate_limits")
      .update({
        request_count: existing.request_count + 1,
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id);

    return {
      allowed: true,
      remaining: config.maxRequests - existing.request_count - 1,
      resetAt: new Date(recordWindowStart.getTime() + config.windowSeconds * 1000),
    };
  }

  await supabase.from("rate_limits").insert({
    identifier,
    endpoint,
    request_count: 1,
    window_start: now.toISOString(),
  });

  return {
    allowed: true,
    remaining: config.maxRequests - 1,
    resetAt: new Date(now.getTime() + config.windowSeconds * 1000),
  };
}

/**
 * Create rate limit exceeded response
 */
export function createRateLimitResponse(resetAt: Date): Response {
  const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
  
  return new Response(
    JSON.stringify({
      error: SAFE_ERROR_MESSAGES.rateLimit,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...responseHeaders,
        "Retry-After": String(retryAfter),
      },
    }
  );
}

/**
 * Validate and sanitize input to prevent injection attacks
 */
export function sanitizeInput(input: string, maxLength: number = 1000): string {
  if (typeof input !== "string") return "";
  
  return input
    .slice(0, maxLength)
    .replace(/[<>]/g, "") // Basic XSS prevention
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
