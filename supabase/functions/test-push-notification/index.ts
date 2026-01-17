import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: "An error occurred. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: "An error occurred. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Test notification sent",
        notificationId: notification.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in test-push-notification:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
