import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

// Module-scope env: read once per isolate. Client itself is per-request
// because each call needs the user's Authorization header for RLS.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    // Extract JWT from Authorization header
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Create client with user's JWT for RLS
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify JWT via getClaims (lightweight, no auth-server round-trip).
    const token = authHeader.replace(/^[Bb]earer\s+/, "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error("Auth getClaims error:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    

    // ── Parallel fetch: roles, broadcast, profile ──
    const [rolesResult, broadcastResult, profileResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select("id, role, club_id, team_id")
        .eq("user_id", userId),
      supabase
        .from("broadcast_messages")
        .select("id, text, image_url, created_at, author_id, reply_to_id")
        .order("created_at", { ascending: false })
        .limit(16),
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const roles = rolesResult.data || [];
    const clubIds = [...new Set(roles.map((r: any) => r.club_id).filter(Boolean))] as string[];
    const teamIds = [...new Set(roles.map((r: any) => r.team_id).filter(Boolean))] as string[];

    // ── Parallel fetch: clubs, teams, club_subscriptions, chat_groups, personal groups, DM convos ──
    const promises: Record<string, PromiseLike<any>> = {};

    if (clubIds.length > 0) {
      promises.clubs = supabase
        .from("clubs")
        .select("id, name, logo_url, sport, is_pro")
        .in("id", clubIds)
        .then((r: any) => r.data || []);

      promises.clubSubs = supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", clubIds)
        .then((r: any) => r.data || []);
    }

    if (teamIds.length > 0) {
      promises.teams = supabase
        .from("teams")
        .select("id, name, logo_url, club_id, level_age")
        .in("id", teamIds)
        .then((r: any) => r.data || []);
    }

    // Chat groups scoped to user's clubs/teams
    if (clubIds.length > 0 || teamIds.length > 0) {
      const filters: string[] = [];
      if (clubIds.length > 0) filters.push(`club_id.in.(${clubIds.join(",")})`);
      if (teamIds.length > 0) filters.push(`team_id.in.(${teamIds.join(",")})`);

      promises.chatGroups = supabase
        .from("chat_groups")
        .select("id, name, club_id, team_id, allowed_roles")
        .or(filters.join(","))
        .then((r: any) => r.data || []);
    }

    // Personal groups (no club/team)
    promises.personalGroups = supabase
      .from("group_members")
      .select("group_id, chat_groups:group_id(id, name, club_id, team_id, allowed_roles)")
      .eq("user_id", userId)
      .limit(10)
      .then((r: any) => r.data || []);

    // DM conversations
    promises.dmConvos = supabase
      .from("direct_conversations")
      .select("id, participant_1, participant_2")
      .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
      .limit(5)
      .then((r: any) => r.data || []);

    const results = await Promise.all(
      Object.entries(promises).map(async ([key, p]) => [key, await p] as const)
    );
    const data: Record<string, any> = {};
    for (const [key, value] of results) {
      data[key] = value;
    }

    // Filter chat groups by user's actual roles
    let accessibleGroups: any[] = [];
    if (data.chatGroups) {
      accessibleGroups = data.chatGroups.filter((group: any) => {
        const userRolesForGroup = roles.filter((r: any) =>
          (group.club_id && r.club_id === group.club_id) ||
          (group.team_id && r.team_id === group.team_id)
        );
        return userRolesForGroup.some((r: any) => group.allowed_roles.includes(r.role));
      });
    }

    // Add personal groups
    if (data.personalGroups) {
      for (const pg of data.personalGroups) {
        const group = (pg as any).chat_groups;
        if (group && !group.club_id && !group.team_id) {
          accessibleGroups.push(group);
        }
      }
    }

    // Determine Pro access
    const isAppAdmin = roles.some((r: any) => r.role === "app_admin");
    let hasProClub = isAppAdmin;

    if (!hasProClub && data.clubSubs) {
      hasProClub = data.clubSubs.some((s: any) =>
        s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
      );
    }

    // Check parent clubs of teams if needed
    if (!hasProClub && data.teams) {
      const teamClubIds = [...new Set(data.teams.map((t: any) => t.club_id).filter(Boolean))] as string[];
      const missingClubIds = teamClubIds.filter((id: string) => !clubIds.includes(id));
      if (missingClubIds.length > 0) {
        const { data: teamClubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", missingClubIds);
        hasProClub = teamClubSubs?.some((s: any) =>
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        ) || false;
      }
    }

    // Check team-level subscriptions
    if (!hasProClub && teamIds.length > 0) {
      const { data: teamSubs } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("team_id", teamIds);
      hasProClub = teamSubs?.some((s: any) =>
        s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
      ) || false;
    }

    const response = {
      roles,
      clubs: data.clubs || [],
      teams: data.teams || [],
      chatGroups: accessibleGroups,
      dmConversations: data.dmConvos || [],
      broadcastMessages: broadcastResult.data || [],
      profile: profileResult.data,
      isAppAdmin,
      hasProClub,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Prefetch error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
