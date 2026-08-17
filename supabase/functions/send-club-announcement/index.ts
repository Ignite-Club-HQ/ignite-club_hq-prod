import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    const apikeyHeader = req.headers.get("apikey");

    if (!authHeader?.startsWith("Bearer ")) {
      console.error("Announcement auth failed: missing bearer token", {
        hasAuthHeader: !!authHeader,
      });
      return new Response(JSON.stringify({ error: "Not authenticated (no bearer token)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? apikeyHeader;

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Reject an anon/publishable key presented as the bearer token.
    if (!accessToken || accessToken === anonKey || accessToken === apikeyHeader) {
      console.error("Announcement auth failed: api key presented as user token");
      return new Response(JSON.stringify({ error: "Not authenticated (no user session)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the caller. Try the anon client first, then fall back to the
    // service-role client: if the legacy anon key is disabled/rotated, the
    // anon-key verification path fails even for a perfectly valid user token.
    let user: { id: string; email?: string | null } | null = null;
    let lastAuthError: string | null = null;

    for (const key of [anonKey, serviceRoleKey]) {
      if (!key) continue;
      try {
        const client = createClient(supabaseUrl, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.getUser(accessToken);
        if (data?.user?.id) {
          user = data.user;
          break;
        }
        lastAuthError = error?.message ?? "no user for token";
      } catch (e) {
        lastAuthError = (e as Error)?.message ?? "verification threw";
      }
    }

    if (!user) {
      console.error("Announcement auth failed", { reason: lastAuthError });
      return new Response(
        JSON.stringify({ error: "Not authenticated (session invalid or expired)" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }


    const { club_id, team_ids, message, club_name, include_club_chat } = await req.json();
    const requestedTeamIds = [...new Set((team_ids || []).filter(Boolean))];
    const sendToClubChat = include_club_chat === true;

    if (!club_id || (!requestedTeamIds.length && !sendToClubChat) || !message?.trim()) {
      return new Response(
        JSON.stringify({ error: "club_id, message and at least one destination required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }


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

    // Get or create bot user
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

    const { data: clubTeams, error: clubTeamsError } = await adminClient
      .from("teams")
      .select("id")
      .eq("club_id", club_id)
      .in("id", requestedTeamIds);

    if (clubTeamsError) throw clubTeamsError;

    const validTeamIds = (clubTeams || []).map((team) => team.id);
    if (validTeamIds.length !== requestedTeamIds.length) {
      return new Response(JSON.stringify({ error: "One or more teams are invalid for this club" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let botUserId = club.bot_user_id;
    const resolvedClubName = club_name || club.name;

    if (!botUserId) {
      // Create bot user
      const botEmail = `bot-${club_id}@club.igniteapp.internal`;
      const botPassword = crypto.randomUUID() + crypto.randomUUID();

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: botEmail,
        password: botPassword,
        email_confirm: true,
        user_metadata: {
          full_name: resolvedClubName,
          is_club_bot: true,
          club_id: club_id,
        },
      });

      if (createError) {
        if (createError.message?.includes("already been registered")) {
          const { data: existingUsers } = await adminClient.auth.admin.listUsers();
          const existing = existingUsers?.users?.find((u) => u.email === botEmail);
          if (existing) botUserId = existing.id;
        }
        if (!botUserId) throw createError;
      } else {
        botUserId = newUser.user.id;
      }

      // Create/update profile
      await adminClient.from("profiles").upsert({
        id: botUserId,
        display_name: resolvedClubName,
        avatar_url: club.logo_url,
      });

      // Store on club
      await adminClient
        .from("clubs")
        .update({ bot_user_id: botUserId })
        .eq("id", club_id);
    } else {
      // Ensure profile is up to date
      await adminClient
        .from("profiles")
        .update({
          display_name: resolvedClubName,
          avatar_url: club.logo_url,
        })
        .eq("id", botUserId);
    }

    const { data: existingBotRoles, error: existingBotRolesError } = await adminClient
      .from("user_roles")
      .select("team_id")
      .eq("user_id", botUserId)
      .in("team_id", validTeamIds);

    if (existingBotRolesError) throw existingBotRolesError;

    const existingBotTeamIds = new Set(
      (existingBotRoles || [])
        .map((role) => role.team_id)
        .filter((teamId): teamId is string => Boolean(teamId))
    );

    const missingBotTeamIds = validTeamIds.filter((teamId) => !existingBotTeamIds.has(teamId));

    if (missingBotTeamIds.length > 0) {
      const { error: botRoleInsertError } = await adminClient.from("user_roles").insert(
        missingBotTeamIds.map((teamId) => ({
          user_id: botUserId,
          club_id,
          team_id: teamId,
          role: "basic_user" as const,
        }))
      );

      if (botRoleInsertError) throw botRoleInsertError;
    }

    if (sendToClubChat) {
      // Ensure the bot has a club-level membership row so club chat access
      // checks / notification fan-out treat it as a member of the club.
      const { data: clubLevelRole, error: clubLevelRoleError } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", botUserId)
        .eq("club_id", club_id)
        .is("team_id", null)
        .maybeSingle();

      if (clubLevelRoleError) throw clubLevelRoleError;

      if (!clubLevelRole) {
        const { error: clubRoleInsertError } = await adminClient.from("user_roles").insert({
          user_id: botUserId,
          club_id,
          role: "basic_user" as const,
        });
        if (clubRoleInsertError) throw clubRoleInsertError;
      }
    }

    // Insert messages using service role (bypasses RLS author_id check)
    if (validTeamIds.length > 0) {
      const inserts = validTeamIds.map((teamId: string) => ({
        team_id: teamId,
        author_id: botUserId,
        text: message.trim(),
        is_club_announcement: true,
        club_announcement_name: resolvedClubName,
      }));

      const { error: insertError } = await adminClient.from("team_messages").insert(inserts);
      if (insertError) throw insertError;
    }

    if (sendToClubChat) {
      const { error: clubInsertError } = await adminClient.from("club_messages").insert({
        club_id,
        author_id: botUserId,
        text: message.trim(),
      });
      if (clubInsertError) throw clubInsertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        bot_user_id: botUserId,
        messages_sent: validTeamIds.length + (sendToClubChat ? 1 : 0),
        club_chat_sent: sendToClubChat,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Error in send-club-announcement:", err);
    return new Response(
      JSON.stringify({ error: (err as Error)?.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
