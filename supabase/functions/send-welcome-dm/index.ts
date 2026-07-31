import { authenticateUser, isServiceRoleCaller, forbidden } from "../_shared/callerAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WELCOME_MESSAGE_TEXT =
  "Welcome to Ignite Club HQ! 🔥\n\nManage your club, teams, schedules, messaging, media and more — all in one place.\n\nTo learn more and see tips on using Ignite, visit:\nhttps://igniteclubhq.com\n\nFor the latest updates, follow us on our [Facebook page](https://www.facebook.com/profile.php?id=61585375267816).";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Either an internal service-role caller, or the signed-in user requesting
  // their own welcome DM. Nothing privileged happens before this resolves.
  let __callerUserId: string | null = null;
  if (!isServiceRoleCaller(req)) {
    const __auth = await authenticateUser(req, corsHeaders);
    if ("response" in __auth) return __auth.response;
    __callerUserId = __auth.user.userId;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role client to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const userId: string | undefined =
      typeof body?.userId === "string" ? body.userId : undefined;

    if (__callerUserId && userId !== __callerUserId) {
      return forbidden(corsHeaders);
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[send-welcome-dm] Sending welcome message to user:", userId);

    // Check if welcome message already sent
    const { data: existingMsg } = await supabase
      .from("system_messages")
      .select("id")
      .eq("user_id", userId)
      .eq("message_type", "welcome")
      .limit(1);
    
    if (existingMsg && existingMsg.length > 0) {
      console.log("[send-welcome-dm] Welcome message already sent, skipping");
      return new Response(
        JSON.stringify({ success: true, alreadySent: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert a welcome message into system_messages table
    const { error: msgError } = await supabase
      .from("system_messages")
      .insert({
        user_id: userId,
        message_type: "welcome",
        text: WELCOME_MESSAGE_TEXT,
      });

    if (msgError) {
      console.error("[send-welcome-dm] Error inserting message:", msgError);
      throw msgError;
    }

    console.log("[send-welcome-dm] Welcome message sent successfully");

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-welcome-dm] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
