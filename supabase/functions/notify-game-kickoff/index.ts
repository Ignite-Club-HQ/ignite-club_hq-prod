// Sends a "It's game time!" push to team admins/coaches and the assigned
// Subs Manager when an event's start_time is reached. Tapping the push
// opens the event-linked pitch board (event detail page).
//
// Triggered by pg_cron every minute. Dedupes via the notifications table
// (type='game_kickoff', related_id=event.id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Window: from 1 min before kickoff to 5 min after. Wide enough to absorb
// cron drift / missed minute, narrow enough to feel timely.
const WINDOW_BEFORE_MIN = 1;
const WINDOW_AFTER_MIN = 5;

interface EventRow {
  id: string;
  title: string;
  team_id: string | null;
  type: string;
  start_time: string | null;
  event_date: string;
  is_cancelled: boolean | null;
  is_bye: boolean | null;
  teams: { name: string | null } | null;
}

async function getRecipients(
  supabase: any,
  eventId: string,
  teamId: string | null,
): Promise<Set<string>> {
  const ids = new Set<string>();

  if (teamId) {
    const { data: staff } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("team_id", teamId)
      .in("role", ["team_admin", "coach"]);
    staff?.forEach((r: any) => r.user_id && ids.add(r.user_id));
  }

  const { data: dutyAssignees } = await supabase
    .from("duties")
    .select("assigned_to")
    .eq("event_id", eventId)
    .eq("name", "Subs Manager")
    .not("assigned_to", "is", null);
  dutyAssignees?.forEach((d: any) => d.assigned_to && ids.add(d.assigned_to));

  return ids;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || cronSecret !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_AFTER_MIN * 60_000).toISOString();
  const windowEnd = new Date(now + WINDOW_BEFORE_MIN * 60_000).toISOString();

  const { data: events, error } = await supabase
    .from("events")
    .select(
      "id, title, team_id, type, start_time, event_date, is_cancelled, is_bye, teams(name)",
    )
    .in("type", ["game", "mini_league"])
    .eq("is_cancelled", false)
    .gte("start_time", windowStart)
    .lte("start_time", windowEnd);

  if (error) {
    console.error("[GAME-KICKOFF] events query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // TEMPORARY ALLOWLIST: while we pilot the kickoff push, only fire for the
  // teams listed in GAME_KICKOFF_TEAM_ALLOWLIST (comma-separated team UUIDs).
  // To unlock for all teams later, simply unset / clear this env var — empty
  // value disables the filter and every game-type event qualifies again.
  // Defaults to U7 White only.
  const allowlistRaw =
    Deno.env.get("GAME_KICKOFF_TEAM_ALLOWLIST") ??
    "76d94b7a-baf5-4867-8015-92fe620b3a97";
  const allowlist = allowlistRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowlistActive = allowlist.length > 0;

  let processed = 0;
  let pushesSent = 0;

  for (const ev of (events ?? []) as EventRow[]) {
    if (ev.is_bye) continue;
    if (!ev.start_time) continue;
    if (allowlistActive && (!ev.team_id || !allowlist.includes(ev.team_id))) {
      continue;
    }

    // Dedupe: skip if any recipient already has a kickoff notif for this event.
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("type", "game_kickoff")
      .eq("related_id", ev.id)
      .limit(1);
    if (existing && existing.length > 0) {
      continue;
    }

    const recipients = await getRecipients(supabase, ev.id, ev.team_id);
    if (recipients.size === 0) continue;

    const teamName = ev.teams?.name ?? "your team";
    const title = `🏁 It's game time — ${teamName}`;
    const body = `${ev.title} is starting now. Tap to open the pitch board and start the game.`;
    // Deep-link straight into the pitch board (EventDetailPage honours
    // ?openPitchBoard=1 and auto-opens the board once access resolves).
    const url = `/events/${ev.id}?openPitchBoard=1`;

    const inserts = Array.from(recipients).map((userId) => ({
      user_id: userId,
      type: "game_kickoff",
      message: `${ev.title} is starting now — tap to open the pitch board.`,
      related_id: ev.id,
      skip_push: true,
    }));

    const { data: inserted } = await supabase
      .from("notifications")
      .insert(inserts)
      .select("id, user_id");

    const idMap = new Map<string, string>();
    (inserted ?? []).forEach((n: any) => idMap.set(n.user_id, n.id));

    await Promise.all(
      Array.from(recipients).map(async (userId) => {
        try {
          await supabase.functions.invoke("send-push-notification", {
            body: {
              userId,
              title,
              body,
              url,
              tag: `game-kickoff-${ev.id}`,
              notificationType: "game_kickoff",
              notificationId: idMap.get(userId),
              data: { eventId: ev.id, type: "game_kickoff" },
            },
          });
          pushesSent++;
        } catch (e) {
          console.error(`[GAME-KICKOFF] push error u=${userId}:`, e);
        }
      }),
    );
    processed++;
  }

  return new Response(
    JSON.stringify({ ok: true, processed, pushesSent }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
});
