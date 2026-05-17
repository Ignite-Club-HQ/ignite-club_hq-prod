import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey")!;
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(accessToken);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { association_id, message, club_ids } = await req.json();
    const msg = (message ?? "").toString().trim();
    if (!association_id || !msg) return json({ error: "association_id and message required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: isAdmin } = await admin.rpc("is_association_admin", {
      _user_id: user.id,
      _association_id: association_id,
    });
    if (!isAdmin) return json({ error: "Not authorized" }, 403);

    const { data: assoc, error: assocErr } = await admin
      .from("clubs")
      .select("id, name, logo_url, bot_user_id, kind")
      .eq("id", association_id)
      .maybeSingle();
    if (assocErr || !assoc) return json({ error: "Association not found" }, 404);

    // Resolve clubs under this association (optionally filtered)
    let clubsQuery = admin.from("clubs").select("id").eq("parent_org_id", association_id);
    if (Array.isArray(club_ids) && club_ids.length > 0) clubsQuery = clubsQuery.in("id", club_ids);
    const { data: childClubs, error: childErr } = await clubsQuery;
    if (childErr) throw childErr;
    const childClubIds = (childClubs ?? []).map((c) => c.id);
    if (childClubIds.length === 0) return json({ error: "No member clubs to broadcast to" }, 400);

    // All teams under those clubs
    const { data: teams, error: teamsErr } = await admin
      .from("teams")
      .select("id")
      .in("club_id", childClubIds);
    if (teamsErr) throw teamsErr;
    const teamIds = Array.from(new Set((teams ?? []).map((t) => t.id)));
    if (teamIds.length === 0) return json({ error: "No teams under selected clubs" }, 400);

    // Use/create association bot
    let botUserId: string | null = assoc.bot_user_id ?? null;
    const senderName = assoc.name;
    const botEmail = `bot-${assoc.id}@club.igniteapp.internal`;
    if (!botUserId) {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: botEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: senderName, is_club_bot: true, club_id: assoc.id },
      });
      if (createErr) {
        if (createErr.message?.includes("already been registered")) {
          const { data: list } = await admin.auth.admin.listUsers();
          botUserId = list?.users?.find((u) => u.email === botEmail)?.id ?? null;
        }
        if (!botUserId) throw createErr;
      } else {
        botUserId = created.user.id;
      }
      await admin.from("profiles").upsert({
        id: botUserId,
        display_name: senderName,
        avatar_url: assoc.logo_url ?? null,
      });
      await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", assoc.id);
    }

    // Ensure bot membership for RLS
    const { data: existing } = await admin
      .from("user_roles")
      .select("team_id")
      .eq("user_id", botUserId!)
      .in("team_id", teamIds);
    const have = new Set((existing ?? []).map((r: any) => r.team_id));
    const missing = teamIds.filter((t) => !have.has(t));
    if (missing.length > 0) {
      const teamClubLookup = new Map<string, string>();
      const { data: teamRows } = await admin.from("teams").select("id, club_id").in("id", missing);
      (teamRows ?? []).forEach((t: any) => teamClubLookup.set(t.id, t.club_id));
      const { error: roleErr } = await admin.from("user_roles").insert(
        missing.map((teamId) => ({
          user_id: botUserId!,
          club_id: teamClubLookup.get(teamId) ?? null,
          team_id: teamId,
          role: "basic_user" as const,
        }))
      );
      if (roleErr) throw roleErr;
    }

    const inserts = teamIds.map((teamId) => ({
      team_id: teamId,
      author_id: botUserId!,
      text: msg,
      is_club_announcement: true,
      club_announcement_name: `${senderName} (association)`,
    }));
    const { error: insErr } = await admin.from("team_messages").insert(inserts);
    if (insErr) throw insErr;

    await admin.from("association_broadcasts").insert({
      association_id,
      sent_by: user.id,
      message: msg,
      club_ids: Array.isArray(club_ids) && club_ids.length > 0 ? club_ids : null,
      team_ids: teamIds,
      recipient_team_count: teamIds.length,
    });

    return json({ success: true, recipient_team_count: teamIds.length, recipient_club_count: childClubIds.length });
  } catch (err) {
    console.error("send-association-broadcast error", err);
    return json({ error: (err as Error)?.message || "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
