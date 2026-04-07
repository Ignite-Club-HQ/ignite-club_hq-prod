import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is a club_admin or app_admin
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { club_id } = await req.json();
    if (!club_id) {
      return new Response(JSON.stringify({ error: "club_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for admin operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is club_admin or app_admin
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role, club_id")
      .eq("user_id", user.id)
      .in("role", ["club_admin", "app_admin"]);

    const isAuthorized = roles?.some(
      (r) => r.role === "app_admin" || (r.role === "club_admin" && r.club_id === club_id)
    );
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if club already has a bot user
    const { data: club } = await adminClient
      .from("clubs")
      .select("bot_user_id, name, logo_url")
      .eq("id", club_id)
      .single();

    if (!club) {
      return new Response(JSON.stringify({ error: "Club not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (club.bot_user_id) {
      // Bot exists, ensure profile is up to date with current club name/logo
      await adminClient
        .from("profiles")
        .update({
          display_name: club.name,
          avatar_url: club.logo_url,
        })
        .eq("id", club.bot_user_id);

      return new Response(
        JSON.stringify({ bot_user_id: club.bot_user_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a new bot auth user with a random email
    const botEmail = `bot-${club_id}@club.igniteapp.internal`;
    const botPassword = crypto.randomUUID() + crypto.randomUUID(); // long random, never used

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: botEmail,
      password: botPassword,
      email_confirm: true,
      user_metadata: {
        full_name: club.name,
        is_club_bot: true,
        club_id: club_id,
      },
    });

    if (createError) {
      // If user already exists (e.g. from previous attempt), find them
      if (createError.message?.includes("already been registered")) {
        const { data: existingUsers } = await adminClient.auth.admin.listUsers();
        const existingBot = existingUsers?.users?.find((u) => u.email === botEmail);
        if (existingBot) {
          // Update club and profile
          await adminClient
            .from("clubs")
            .update({ bot_user_id: existingBot.id })
            .eq("id", club_id);

          await adminClient.from("profiles").upsert({
            id: existingBot.id,
            display_name: club.name,
            avatar_url: club.logo_url,
          });

          return new Response(
            JSON.stringify({ bot_user_id: existingBot.id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      throw createError;
    }

    const botUserId = newUser.user.id;

    // Create/update profile for the bot
    await adminClient.from("profiles").upsert({
      id: botUserId,
      display_name: club.name,
      avatar_url: club.logo_url,
    });

    // Store bot_user_id on the club
    await adminClient
      .from("clubs")
      .update({ bot_user_id: botUserId })
      .eq("id", club_id);

    return new Response(
      JSON.stringify({ bot_user_id: botUserId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in get-or-create-club-bot:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
