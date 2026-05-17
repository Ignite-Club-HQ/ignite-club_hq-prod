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
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Not authenticated" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey")!;
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(accessToken);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { competition_id, message, division_ids } = await req.json();
    const msg = (message ?? "").toString().trim();
    if (!competition_id || !msg) return json({ error: "competition_id and message required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Authorize: caller must be a competition admin/owner
    const { data: isAdmin } = await admin.rpc("is_competition_admin", {
      _user_id: user.id,
      _competition_id: competition_id,
    });
    if (!isAdmin) return json({ error: "Not authorized" }, 403);

    // Load competition + organizer club (to use its bot for chat author)
    const { data: comp, error: compErr } = await admin
      .from("competitions")
      .select("id, name, organizer_club_id, clubs:organizer_club_id(id, name, logo_url, bot_user_id)")
      .eq("id", competition_id)
      .maybeSingle();
    if (compErr || !comp) return json({ error: "Competition not found" }, 404);

    // Resolve accepted entries (optionally filter by division)
    let entriesQuery = admin
      .from("competition_entries")
      .select("team_id, division_id")
      .eq("competition_id", competition_id)
      .eq("status", "accepted");
    if (Array.isArray(division_ids) && division_ids.length > 0) {
      entriesQuery = entriesQuery.in("division_id", division_ids);
    }
    const { data: entries, error: entriesErr } = await entriesQuery;
    if (entriesErr) throw entriesErr;

    const teamIds = Array.from(new Set((entries ?? []).map((e: any) => e.team_id).filter(Boolean)));
    if (teamIds.length === 0) return json({ error: "No accepted teams to broadcast to" }, 400);

    // Resolve / create bot author. Prefer organizer club bot; fall back to a per-competition bot.
    const club = comp.clubs as any;
    let botUserId: string | null = club?.bot_user_id ?? null;
    const senderName = comp.name;
    const botEmail = club?.id
      ? `bot-${club.id}@club.igniteapp.internal`
      : `comp-bot-${competition_id}@competition.igniteapp.internal`;

    if (!botUserId) {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: botEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: senderName, is_club_bot: true, club_id: club?.id ?? null },
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
        display_name: club?.name ?? senderName,
        avatar_url: club?.logo_url ?? null,
      });
      if (club?.id) {
        await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", club.id);
      }
    }

    // Ensure bot has a basic_user role on each recipient team so the message insert satisfies RLS-derived constraints
    const { data: existingRoles } = await admin
      .from("user_roles")
      .select("team_id")
      .eq("user_id", botUserId!)
      .in("team_id", teamIds);
    const have = new Set((existingRoles ?? []).map((r: any) => r.team_id));
    const missing = teamIds.filter((t) => !have.has(t));
    if (missing.length > 0) {
      const { error: roleErr } = await admin.from("user_roles").insert(
        missing.map((teamId) => ({
          user_id: botUserId!,
          club_id: club?.id ?? null,
          team_id: teamId,
          role: "basic_user" as const,
        }))
      );
      if (roleErr) throw roleErr;
    }

    // Insert messages
    const inserts = teamIds.map((teamId) => ({
      team_id: teamId,
      author_id: botUserId!,
      text: msg,
      is_club_announcement: true,
      club_announcement_name: `${senderName} (competition)`,
    }));
    const { error: insErr } = await admin.from("team_messages").insert(inserts);
    if (insErr) throw insErr;

    // Audit log
    await admin.from("competition_broadcasts").insert({
      competition_id,
      sent_by: user.id,
      message: msg,
      division_ids: Array.isArray(division_ids) && division_ids.length > 0 ? division_ids : null,
      team_ids: teamIds,
      recipient_team_count: teamIds.length,
    });

    return json({ success: true, recipient_team_count: teamIds.length });
  } catch (err) {
    console.error("send-competition-broadcast error", err);
    return json({ error: (err as Error)?.message || "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
