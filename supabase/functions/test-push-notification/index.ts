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

    const { delay, userId: targetUserId, email } = await req.json().catch(() => ({}));

    let userId: string | null = null;

    // If targetUserId or email provided (admin test mode), use that directly
    if (targetUserId || email) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      
      if (email) {
        // Look up user by email
        const { data: profile } = await adminClient
          .from("profiles")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        
        if (!profile) {
          return new Response(
            JSON.stringify({ error: `No user found with email: ${email}` }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        userId = profile.id;
      } else {
        userId = targetUserId;
      }
      
      console.log(`[test-push] Admin test mode - sending to user: ${userId}`);
    } else {
      // Normal authenticated mode
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authentication required. Pass userId or email for admin test." }),
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
      userId = user.id;
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user has push subscriptions
    const { data: subs, error: subsError } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint")
      .eq("user_id", userId);

    if (subsError) {
      console.error("Failed to check subscriptions:", subsError);
    }

    console.log(`[test-push] User ${userId} has ${subs?.length || 0} push subscriptions`);

    // Create a test notification
    const { data: notification, error: notificationError } = await adminClient
      .from("notifications")
      .insert({
        user_id: userId,
        type: "test",
        message: "🔔 This is a test push notification from Ignite Club HQ!",
        is_read: false,
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
          userId: userId,
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
        subscriptionsFound: subs?.length || 0,
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
