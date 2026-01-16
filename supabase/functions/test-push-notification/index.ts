import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  responseHeaders,
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  sanitizeErrorMessage,
  checkRequestSize,
  MAX_REQUEST_SIZES,
  SAFE_ERROR_MESSAGES,
} from "../_shared/security.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check request size to prevent memory exhaustion
    if (!checkRequestSize(req, MAX_REQUEST_SIZES.small)) {
      return createErrorResponse(new Error("Request too large"), 413, "Request too large");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.unauthorized), 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.unauthorized), 401);
    }

    const { delay } = await req.json().catch(() => ({ delay: 0 }));

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Create a test notification
    const { data: notification, error: notificationError } = await adminClient
      .from("notifications")
      .insert({
        user_id: user.id,
        type: "test",
        message: "🔔 This is a test push notification from Ignite Club HQ!",
        read: false,
      })
      .select()
      .single();

    if (notificationError) {
      console.error("Failed to create notification:", notificationError);
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.internal), 500);
    }

    // Small delay if requested (for testing timing)
    if (delay && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 5000)));
    }

    // Invoke the send-push-notification function
    const { error: invokeError } = await adminClient.functions.invoke(
      "send-push-notification",
      {
        body: {
          userId: user.id,
          title: "Test Notification",
          body: "🔔 This is a test push notification from Ignite Club HQ!",
          url: "/notifications",
          notificationId: notification.id,
          tag: `test-${notification.id}`,
        },
      }
    );

    if (invokeError) {
      console.error("Failed to send push notification:", invokeError);
      return createErrorResponse(new Error(SAFE_ERROR_MESSAGES.internal), 500);
    }

    return createSuccessResponse({
      success: true,
      message: "Test notification sent",
      notificationId: notification.id,
    });

  } catch (error) {
    console.error("Error in test-push-notification:", error);
    return createErrorResponse(error, 500);
  }
});
