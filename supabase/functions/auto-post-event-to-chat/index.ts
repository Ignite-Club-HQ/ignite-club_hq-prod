// Auto-post matches & training to a team's chat from the club's auto bot.
// Triggered asynchronously by an `events` AFTER INSERT / AFTER UPDATE OF
// is_cancelled trigger via pg_net.
//
// Behaviour:
// - Skips unless event.type in ('match', 'training')
// - Skips recurring child instances (parent_event_id IS NULL only)
// - Respects per-team toggle teams.auto_chat_post_enabled
// - On create: posts a single chat message and stores its id on
//   events.chat_post_message_id (idempotent — re-fires are no-ops).
// - On cancel: posts a follow-up cancellation message (only if a create
//   message was already posted, so we don't surprise members with a
//   cancellation for an event they were never told about in chat).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type Action = "event_created" | "event_cancelled";

const LOCAL_TIME_ZONE = "Australia/Adelaide";

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // E.g. "Sat 16 May, 2:30 PM"
  // Edge runtime is UTC — always render in club-local time so chat posts match
  // the Schedule / Next Up cards users see on their devices.
  const date = d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: LOCAL_TIME_ZONE,
  });
  const time = d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: LOCAL_TIME_ZONE,
  });
  return `${date}, ${time}`;
}

async function ensureBot(
  clubId: string,
  clubName: string,
  logoUrl: string | null,
): Promise<string | null> {
  const { data: club } = await admin
    .from("clubs")
    .select("bot_user_id")
    .eq("id", clubId)
    .maybeSingle();
  if (club?.bot_user_id) return club.bot_user_id;

  const botEmail = `bot-${clubId}@club.igniteapp.internal`;
  const botPassword = crypto.randomUUID() + crypto.randomUUID();

  let botUserId: string | null = null;
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: botEmail,
      password: botPassword,
      email_confirm: true,
      user_metadata: { full_name: clubName, is_club_bot: true, club_id: clubId },
    });
  if (createErr) {
    if (createErr.message?.includes("already been registered")) {
      const { data: existing } = await admin.auth.admin.listUsers();
      const found = existing?.users?.find((u: any) => u.email === botEmail);
      if (found) botUserId = found.id;
    }
    if (!botUserId) {
      console.error("ensureBot create failed", clubId, createErr);
      return null;
    }
  } else {
    botUserId = created.user.id;
  }

  await admin
    .from("profiles")
    .upsert({ id: botUserId, display_name: clubName, avatar_url: logoUrl });
  await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", clubId);
  return botUserId;
}

async function ensureBotInTeam(botUserId: string, clubId: string, teamId: string) {
  const { data: existing } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", botUserId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (existing) return;
  await admin.from("user_roles").insert({
    user_id: botUserId,
    club_id: clubId,
    team_id: teamId,
    role: "basic_user",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as Action;
    const eventId = body.eventId as string | undefined;

    if (!eventId || (action !== "event_created" && action !== "event_cancelled")) {
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ev, error: evErr } = await admin
      .from("events")
      .select(
        "id, club_id, team_id, type, title, event_date, location_name, location, opponent, is_home_game, parent_event_id, is_cancelled, chat_post_message_id",
      )
      .eq("id", eventId)
      .maybeSingle();

    if (evErr || !ev) {
      console.error("event load failed", eventId, evErr);
      return new Response(JSON.stringify({ error: "event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      !ev.team_id ||
      !ev.club_id ||
      ev.parent_event_id ||
      (ev.type !== "match" && ev.type !== "training")
    ) {
      return new Response(JSON.stringify({ skipped: "not eligible" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Per-team toggle
    const { data: team } = await admin
      .from("teams")
      .select("name, auto_chat_post_enabled")
      .eq("id", ev.team_id)
      .maybeSingle();
    if (!team || team.auto_chat_post_enabled === false) {
      return new Response(JSON.stringify({ skipped: "team opted out" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency for create
    if (action === "event_created" && ev.chat_post_message_id) {
      return new Response(JSON.stringify({ skipped: "already posted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For cancel — only post if we previously announced
    if (action === "event_cancelled" && !ev.chat_post_message_id) {
      return new Response(
        JSON.stringify({ skipped: "no original chat post" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: club } = await admin
      .from("clubs")
      .select("name, logo_url")
      .eq("id", ev.club_id)
      .maybeSingle();
    const clubName = club?.name || "Club";
    const botUserId = await ensureBot(
      ev.club_id,
      clubName,
      club?.logo_url ?? null,
    );
    if (!botUserId) {
      return new Response(JSON.stringify({ error: "bot unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await ensureBotInTeam(botUserId, ev.club_id, ev.team_id);

    const link = `https://igniteclubhq.app/events/${ev.id}`;
    const when = fmtWhen(ev.event_date);
    const where =
      ev.location_name?.trim() || ev.location?.trim() || null;
    const isMatch = ev.type === "match";
    const eventLabel = isMatch ? "Match" : "Training";
    const title = (ev.title || "").trim() || eventLabel;

    let text: string;
    if (action === "event_created") {
      const lines: string[] = [];
      const headline = isMatch && ev.opponent
        ? `📅 New match scheduled: ${title} vs ${ev.opponent}${ev.is_home_game === false ? " (away)" : ev.is_home_game === true ? " (home)" : ""}`
        : `📅 New ${eventLabel.toLowerCase()} scheduled: ${title}`;
      lines.push(headline);
      if (when) lines.push(`🕒 ${when}`);
      if (where) lines.push(`📍 ${where}`);
      lines.push("");
      lines.push("Please RSVP 👇");
      lines.push(link);
      lines.push(`[rsvp:${ev.id}]`);
      text = lines.join("\n");
    } else {
      // cancelled
      text = [
        `❌ ${eventLabel} cancelled: ${title}${when ? ` — ${when}` : ""}`,
        "",
        link,
      ].join("\n");
    }

    const { data: inserted, error: insErr } = await admin
      .from("team_messages")
      .insert({
        team_id: ev.team_id,
        author_id: botUserId,
        text,
        is_club_announcement: true,
        club_announcement_name: clubName,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("team_messages insert failed", insErr);
      return new Response(JSON.stringify({ error: insErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "event_created") {
      await admin
        .from("events")
        .update({ chat_post_message_id: inserted.id })
        .eq("id", ev.id);
    }

    return new Response(
      JSON.stringify({ ok: true, message_id: inserted.id, action }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-post-event-to-chat fatal", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
